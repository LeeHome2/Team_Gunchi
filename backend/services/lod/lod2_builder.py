"""
LOD2 매스 생성 — 벽 + 슬래브 (바닥/지붕).

centerline 재구성 결과를 받아서:
1. 벽 메쉬 생성 (centerline 기반 압출)
2. 바닥 슬래브 (두께 0.2m)
3. 평지붕 슬래브 (두께 0.3m)
4. multi-primitive GLB 조립

실패 시 None 반환 → 호출자가 LOD1 fallback.
"""

import logging
import struct
import json
from typing import List, Tuple, Optional, Dict, Any
import numpy as np
import trimesh
from shapely.geometry import Polygon as ShapelyPolygon, LineString, MultiPolygon
from shapely.ops import unary_union

from .wall_types import WallSegment, WallLoop, CenterlineResult

logger = logging.getLogger(__name__)


# ============= 상수 =============

FLOOR_SLAB_THICKNESS = 0.2   # 바닥 슬래브 두께 (m)
ROOF_SLAB_THICKNESS = 0.3    # 지붕 슬래브 두께 (m)
FOUNDATION_DEPTH = -1.0      # 지하 기초 깊이 (m)

# 머티리얼 색상 (RGBA 0-255)
WALL_COLOR = (220, 220, 210, 255)      # 베이지/크림
FLOOR_COLOR = (180, 180, 180, 255)     # 회색
ROOF_COLOR = (160, 160, 170, 255)      # 진한 회색


# ============= 메쉬 생성 헬퍼 =============

def _z_to_y_up(vertices: np.ndarray) -> np.ndarray:
    """Z-up → Y-up 변환: [x, y, z] → [x, z, -y]"""
    return np.column_stack([
        vertices[:, 0],
        vertices[:, 2],
        -vertices[:, 1]
    ])


def _compute_face_normals(vertices: np.ndarray, faces: np.ndarray) -> np.ndarray:
    """면 법선 계산 후 정점별 법선으로 확장"""
    v0 = vertices[faces[:, 0]]
    v1 = vertices[faces[:, 1]]
    v2 = vertices[faces[:, 2]]

    face_normals = np.cross(v1 - v0, v2 - v0)
    fn_len = np.linalg.norm(face_normals, axis=1, keepdims=True)
    fn_len[fn_len < 1e-10] = 1.0
    face_normals = face_normals / fn_len

    # 정점별 법선 (단순화: 면 법선을 정점에 복사)
    normals = np.zeros_like(vertices)
    for i, face in enumerate(faces):
        for vi in face:
            normals[vi] = face_normals[i]

    return normals


def create_wall_mesh_from_segment(
    segment: WallSegment,
    height: float,
    base_z: float = 0.0
) -> Optional[trimesh.Trimesh]:
    """WallSegment에서 벽 메쉬 생성.

    centerline을 thickness만큼 buffer하여 폴리곤 생성 후 압출.
    """
    try:
        line = LineString([segment.start, segment.end])
        # buffer로 폴리곤 생성 (cap_style=2: flat ends)
        poly = line.buffer(segment.thickness / 2, cap_style=2)

        if poly.is_empty or not poly.is_valid:
            return None

        # 압출
        mesh = trimesh.creation.extrude_polygon(poly, height=height)
        # Z 이동
        if base_z != 0:
            mesh.vertices[:, 2] += base_z

        return mesh
    except Exception as e:
        logger.warning(f"벽 세그먼트 메쉬 생성 실패: {e}")
        return None


def create_wall_mesh_from_loop(
    loop: WallLoop,
    height: float,
    base_z: float = 0.0
) -> Optional[trimesh.Trimesh]:
    """WallLoop에서 벽 메쉬 생성.

    외곽선 폴리곤을 내부로 offset하여 벽체 링 생성 후 압출.
    """
    try:
        if len(loop.points) < 3:
            return None

        outer = ShapelyPolygon(loop.points)
        if not outer.is_valid:
            outer = outer.buffer(0)

        # 내부 offset (negative buffer)
        inner = outer.buffer(-loop.thickness)

        if inner.is_empty or not inner.is_valid:
            # offset 실패 시 전체 폴리곤으로 fallback
            mesh = trimesh.creation.extrude_polygon(outer, height=height)
        else:
            # 외곽 - 내부 = 벽체 링
            wall_ring = outer.difference(inner)
            if wall_ring.is_empty:
                return None
            mesh = trimesh.creation.extrude_polygon(wall_ring, height=height)

        if base_z != 0:
            mesh.vertices[:, 2] += base_z

        return mesh
    except Exception as e:
        logger.warning(f"벽 루프 메쉬 생성 실패: {e}")
        return None


def create_slab_mesh(
    footprint: ShapelyPolygon,
    thickness: float,
    base_z: float
) -> Optional[trimesh.Trimesh]:
    """슬래브 메쉬 생성 (바닥 또는 지붕).

    Args:
        footprint: 슬래브 외곽선 폴리곤
        thickness: 슬래브 두께
        base_z: 슬래브 하단 Z 좌표
    """
    try:
        if footprint.is_empty or not footprint.is_valid:
            return None

        mesh = trimesh.creation.extrude_polygon(footprint, height=thickness)
        mesh.vertices[:, 2] += base_z

        return mesh
    except Exception as e:
        logger.warning(f"슬래브 메쉬 생성 실패: {e}")
        return None


def extract_footprint(centerline_result: CenterlineResult) -> Optional[ShapelyPolygon]:
    """centerline 결과에서 건물 footprint 추출.

    1. WallLoop가 있으면 가장 큰 루프의 외곽선 사용
    2. WallSegment만 있으면 모든 세그먼트의 convex hull
    """
    try:
        # WallLoop에서 추출
        if centerline_result.loops:
            max_area = 0
            best_poly = None
            for loop in centerline_result.loops:
                if len(loop.points) >= 3:
                    poly = ShapelyPolygon(loop.points)
                    if poly.is_valid and poly.area > max_area:
                        max_area = poly.area
                        best_poly = poly
            if best_poly:
                return best_poly

        # WallSegment에서 추출
        if centerline_result.segments:
            all_points = []
            for seg in centerline_result.segments:
                all_points.append(seg.start)
                all_points.append(seg.end)

            if len(all_points) >= 3:
                from shapely.geometry import MultiPoint
                mp = MultiPoint(all_points)
                hull = mp.convex_hull
                if isinstance(hull, ShapelyPolygon) and hull.is_valid:
                    return hull

        return None
    except Exception as e:
        logger.warning(f"Footprint 추출 실패: {e}")
        return None


# ============= Multi-primitive GLB 생성 =============

def _export_multi_primitive_glb(
    meshes: List[Tuple[np.ndarray, np.ndarray, Tuple[int, int, int, int], str]],
    output_path: str
) -> Dict[str, Any]:
    """여러 메쉬를 multi-primitive GLB로 조립.

    Args:
        meshes: [(vertices, faces, color_rgba, name), ...] 리스트
        output_path: 출력 GLB 경로

    Returns:
        mesh_stats 정보
    """
    if not meshes:
        raise ValueError("메쉬가 비어있습니다")

    # 각 메쉬의 바이너리 데이터 준비
    all_idx_bytes = []
    all_vtx_bytes = []
    all_nrm_bytes = []
    primitives = []
    materials = []
    accessors = []
    buffer_views = []

    current_offset = 0
    accessor_idx = 0
    total_vertices = 0
    total_faces = 0

    for i, (verts, faces, color, name) in enumerate(meshes):
        # Y-up 변환
        verts_yup = _z_to_y_up(verts)
        normals = _compute_face_normals(verts_yup, faces)

        verts_f32 = verts_yup.astype(np.float32)
        norms_f32 = normals.astype(np.float32)
        indices_u32 = faces.flatten().astype(np.uint32)

        idx_bytes = indices_u32.tobytes()
        vtx_bytes = verts_f32.tobytes()
        nrm_bytes = norms_f32.tobytes()

        # 바운딩 박스
        v_min = verts_f32.min(axis=0).tolist()
        v_max = verts_f32.max(axis=0).tolist()

        # 머티리얼
        base_color = [c / 255.0 for c in color[:4]]
        materials.append({
            "pbrMetallicRoughness": {
                "baseColorFactor": base_color,
                "metallicFactor": 0.0,
                "roughnessFactor": 0.8 if 'wall' in name.lower() else 0.9,
            },
            "doubleSided": True,
            "name": name
        })

        # Buffer views
        idx_bv = len(buffer_views)
        buffer_views.append({
            "buffer": 0,
            "byteOffset": current_offset,
            "byteLength": len(idx_bytes),
            "target": 34963  # ELEMENT_ARRAY_BUFFER
        })
        current_offset += len(idx_bytes)

        vtx_bv = len(buffer_views)
        buffer_views.append({
            "buffer": 0,
            "byteOffset": current_offset,
            "byteLength": len(vtx_bytes),
            "target": 34962  # ARRAY_BUFFER
        })
        current_offset += len(vtx_bytes)

        nrm_bv = len(buffer_views)
        buffer_views.append({
            "buffer": 0,
            "byteOffset": current_offset,
            "byteLength": len(nrm_bytes),
            "target": 34962
        })
        current_offset += len(nrm_bytes)

        # Accessors
        idx_acc = len(accessors)
        accessors.append({
            "bufferView": idx_bv,
            "componentType": 5125,  # UNSIGNED_INT
            "count": len(indices_u32),
            "type": "SCALAR",
            "max": [int(indices_u32.max())] if len(indices_u32) > 0 else [0],
            "min": [int(indices_u32.min())] if len(indices_u32) > 0 else [0],
        })

        vtx_acc = len(accessors)
        accessors.append({
            "bufferView": vtx_bv,
            "componentType": 5126,  # FLOAT
            "count": len(verts_f32),
            "type": "VEC3",
            "max": v_max,
            "min": v_min,
        })

        nrm_acc = len(accessors)
        accessors.append({
            "bufferView": nrm_bv,
            "componentType": 5126,
            "count": len(norms_f32),
            "type": "VEC3",
        })

        # Primitive
        primitives.append({
            "attributes": {"POSITION": vtx_acc, "NORMAL": nrm_acc},
            "indices": idx_acc,
            "material": i,
            "mode": 4,  # TRIANGLES
        })

        all_idx_bytes.append(idx_bytes)
        all_vtx_bytes.append(vtx_bytes)
        all_nrm_bytes.append(nrm_bytes)

        total_vertices += len(verts_f32)
        total_faces += len(faces)

    # 바이너리 버퍼 조립
    bin_data = b''.join(all_idx_bytes) + b''.join(all_vtx_bytes) + b''.join(all_nrm_bytes)
    bin_pad = (4 - len(bin_data) % 4) % 4
    bin_data += b'\x00' * bin_pad

    # glTF JSON
    gltf_json = {
        "asset": {"version": "2.0", "generator": "building_cesium_lod2"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": "building_lod2"}],
        "meshes": [{"primitives": primitives}],
        "materials": materials,
        "accessors": accessors,
        "bufferViews": buffer_views,
        "buffers": [{"byteLength": len(bin_data)}],
    }

    json_str = json.dumps(gltf_json, separators=(',', ':'))
    json_bytes = json_str.encode('utf-8')
    json_pad = (4 - len(json_bytes) % 4) % 4
    json_bytes += b' ' * json_pad

    # GLB 파일 작성
    total_size = 12 + 8 + len(json_bytes) + 8 + len(bin_data)

    with open(output_path, 'wb') as f:
        f.write(struct.pack('<4sII', b'glTF', 2, total_size))
        f.write(struct.pack('<I4s', len(json_bytes), b'JSON'))
        f.write(json_bytes)
        f.write(struct.pack('<I4s', len(bin_data), b'BIN\x00'))
        f.write(bin_data)

    return {
        "primitives": len(primitives),
        "vertices": total_vertices,
        "faces": total_faces,
    }


# ============= LOD2 빌드 메인 함수 =============

def build_lod2(
    centerline_result: CenterlineResult,
    height: float = 4.0,
    output_path: str = "building_lod2.glb"
) -> Optional[Dict[str, Any]]:
    """LOD2 매스 생성 (벽 + 바닥 슬래브 + 지붕 슬래브).

    Args:
        centerline_result: Phase 1 centerline 재구성 결과
        height: 건물 높이 (m)
        output_path: 출력 GLB 경로

    Returns:
        성공 시 {"success": True, "mesh_stats": {...}, "steps": [...]}
        실패 시 None → 호출자가 LOD1 fallback
    """
    if not centerline_result.is_usable:
        logger.warning(f"Centerline 성공률 {centerline_result.success_rate:.1%} < 80%, LOD1 fallback 권장")
        return None

    steps = []
    meshes_data = []  # [(vertices, faces, color, name), ...]

    # 1. Footprint 추출
    footprint = extract_footprint(centerline_result)
    if footprint is None:
        logger.warning("Footprint 추출 실패")
        return None
    steps.append({"label": "Footprint 추출", "detail": f"면적: {footprint.area:.2f}㎡"})

    # 2. 벽 메쉬 생성
    wall_meshes = []

    # 세그먼트에서
    for seg in centerline_result.segments:
        mesh = create_wall_mesh_from_segment(seg, height, base_z=0)
        if mesh:
            wall_meshes.append(mesh)

    # 루프에서
    for loop in centerline_result.loops:
        mesh = create_wall_mesh_from_loop(loop, height, base_z=0)
        if mesh:
            wall_meshes.append(mesh)

    if not wall_meshes:
        logger.warning("벽 메쉬 생성 실패")
        return None

    # 벽 메쉬 병합
    combined_walls = trimesh.util.concatenate(wall_meshes)
    meshes_data.append((
        np.array(combined_walls.vertices),
        np.array(combined_walls.faces),
        WALL_COLOR,
        "walls"
    ))
    steps.append({"label": "벽 메쉬 생성", "detail": f"{len(wall_meshes)}개 벽체"})

    # 3. 바닥 슬래브
    floor_mesh = create_slab_mesh(footprint, FLOOR_SLAB_THICKNESS, base_z=FOUNDATION_DEPTH)
    if floor_mesh:
        meshes_data.append((
            np.array(floor_mesh.vertices),
            np.array(floor_mesh.faces),
            FLOOR_COLOR,
            "floor_slab"
        ))
        steps.append({"label": "바닥 슬래브 생성", "detail": f"두께: {FLOOR_SLAB_THICKNESS}m"})

    # 4. 지붕 슬래브
    roof_mesh = create_slab_mesh(footprint, ROOF_SLAB_THICKNESS, base_z=height)
    if roof_mesh:
        meshes_data.append((
            np.array(roof_mesh.vertices),
            np.array(roof_mesh.faces),
            ROOF_COLOR,
            "roof_slab"
        ))
        steps.append({"label": "지붕 슬래브 생성", "detail": f"두께: {ROOF_SLAB_THICKNESS}m"})

    # 5. GLB 조립
    try:
        mesh_stats = _export_multi_primitive_glb(meshes_data, output_path)
        steps.append({"label": "GLB 파일 저장", "detail": f"{mesh_stats['primitives']}개 primitive"})

        logger.info(f"LOD2 매스 생성 완료: {mesh_stats['vertices']} vertices, {mesh_stats['faces']} faces")

        return {
            "success": True,
            "lod": 2,
            "mesh_stats": mesh_stats,
            "steps": steps,
            "footprint_area": footprint.area,
        }
    except Exception as e:
        logger.error(f"GLB 생성 실패: {e}")
        return None


# ============= LOD2.5 (개구부 포함) =============

# 개구부 색상
DOOR_COLOR = (139, 90, 43, 255)       # 갈색
WINDOW_COLOR = (135, 206, 235, 180)   # 하늘색 반투명


def build_lod2_with_openings(
    centerline_result: CenterlineResult,
    dxf_path: str,
    door_layers: List[str],
    window_layers: List[str],
    height: float = 4.0,
    output_path: str = "building_lod2_5.glb"
) -> Optional[Dict[str, Any]]:
    """LOD2.5 매스 생성 (벽 + 슬래브 + 텍스처 개구부).

    Phase 3: 개구부를 색칠된 사각형으로 표현 (실제 구멍 X).

    Args:
        centerline_result: Phase 1 centerline 재구성 결과
        dxf_path: DXF 파일 경로 (개구부 추출용)
        door_layers: 문 레이어 이름 목록
        window_layers: 창문 레이어 이름 목록
        height: 건물 높이 (m)
        output_path: 출력 GLB 경로

    Returns:
        성공 시 {"success": True, "mesh_stats": {...}, "steps": [...]}
        실패 시 None → LOD2 또는 LOD1 fallback
    """
    from .openings import extract_openings, map_openings_to_walls, create_opening_quads

    if not centerline_result.is_usable:
        logger.warning(f"Centerline 성공률 {centerline_result.success_rate:.1%} < 80%, fallback 권장")
        return None

    steps = []
    meshes_data = []

    # 1. Footprint 추출
    footprint = extract_footprint(centerline_result)
    if footprint is None:
        logger.warning("Footprint 추출 실패")
        return None
    steps.append({"label": "Footprint 추출", "detail": f"면적: {footprint.area:.2f}㎡"})

    # 2. 벽 메쉬 생성
    wall_meshes = []
    for seg in centerline_result.segments:
        mesh = create_wall_mesh_from_segment(seg, height, base_z=0)
        if mesh:
            wall_meshes.append(mesh)
    for loop in centerline_result.loops:
        mesh = create_wall_mesh_from_loop(loop, height, base_z=0)
        if mesh:
            wall_meshes.append(mesh)

    if not wall_meshes:
        logger.warning("벽 메쉬 생성 실패")
        return None

    combined_walls = trimesh.util.concatenate(wall_meshes)
    meshes_data.append((
        np.array(combined_walls.vertices),
        np.array(combined_walls.faces),
        WALL_COLOR,
        "walls"
    ))
    steps.append({"label": "벽 메쉬 생성", "detail": f"{len(wall_meshes)}개 벽체"})

    # 3. 바닥 슬래브
    floor_mesh = create_slab_mesh(footprint, FLOOR_SLAB_THICKNESS, base_z=FOUNDATION_DEPTH)
    if floor_mesh:
        meshes_data.append((
            np.array(floor_mesh.vertices),
            np.array(floor_mesh.faces),
            FLOOR_COLOR,
            "floor_slab"
        ))
        steps.append({"label": "바닥 슬래브 생성", "detail": f"두께: {FLOOR_SLAB_THICKNESS}m"})

    # 4. 지붕 슬래브
    roof_mesh = create_slab_mesh(footprint, ROOF_SLAB_THICKNESS, base_z=height)
    if roof_mesh:
        meshes_data.append((
            np.array(roof_mesh.vertices),
            np.array(roof_mesh.faces),
            ROOF_COLOR,
            "roof_slab"
        ))
        steps.append({"label": "지붕 슬래브 생성", "detail": f"두께: {ROOF_SLAB_THICKNESS}m"})

    # 5. 개구부 추출 및 매핑
    openings = extract_openings(dxf_path, door_layers, window_layers)
    if openings:
        mapped = map_openings_to_walls(openings, centerline_result)
        if mapped:
            quads = create_opening_quads(mapped, wall_height=height)

            # 문과 창문 분리
            door_verts = []
            door_faces = []
            window_verts = []
            window_faces = []

            for quad_verts, opening_type in quads:
                # quad를 2개의 삼각형으로 변환
                # 정점 순서: 0-1-2-3 (반시계방향)
                # 삼각형: (0,1,2), (0,2,3)
                if opening_type == 'door':
                    base_idx = len(door_verts)
                    door_verts.extend(quad_verts.tolist())
                    door_faces.append([base_idx, base_idx + 1, base_idx + 2])
                    door_faces.append([base_idx, base_idx + 2, base_idx + 3])
                else:
                    base_idx = len(window_verts)
                    window_verts.extend(quad_verts.tolist())
                    window_faces.append([base_idx, base_idx + 1, base_idx + 2])
                    window_faces.append([base_idx, base_idx + 2, base_idx + 3])

            # 문 메쉬 추가
            if door_verts:
                meshes_data.append((
                    np.array(door_verts),
                    np.array(door_faces),
                    DOOR_COLOR,
                    "doors"
                ))
                steps.append({"label": "문 개구부", "detail": f"{len(door_faces)//2}개"})

            # 창문 메쉬 추가
            if window_verts:
                meshes_data.append((
                    np.array(window_verts),
                    np.array(window_faces),
                    WINDOW_COLOR,
                    "windows"
                ))
                steps.append({"label": "창문 개구부", "detail": f"{len(window_faces)//2}개"})

    # 6. GLB 조립
    try:
        mesh_stats = _export_multi_primitive_glb(meshes_data, output_path)
        steps.append({"label": "GLB 파일 저장", "detail": f"{mesh_stats['primitives']}개 primitive"})

        logger.info(f"LOD2.5 매스 생성 완료: {mesh_stats['vertices']} vertices, {mesh_stats['faces']} faces")

        return {
            "success": True,
            "lod": 2.5,
            "mesh_stats": mesh_stats,
            "steps": steps,
            "footprint_area": footprint.area,
        }
    except Exception as e:
        logger.error(f"GLB 생성 실패: {e}")
        return None
