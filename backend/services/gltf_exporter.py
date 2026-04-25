"""
glTF/GLB 모델 생성 서비스
건물 footprint를 3D 매스로 변환하여 glTF 형식으로 내보냅니다.

PBR 머티리얼을 사용하여 CesiumJS에서 올바르게 렌더링됩니다.
"""

import numpy as np
import trimesh
from trimesh.visual.material import PBRMaterial
from typing import List, Optional, Tuple
import logging

logger = logging.getLogger(__name__)


def _export_clean_glb(
    vertices: np.ndarray,
    faces: np.ndarray,
    normals: np.ndarray,
    color: Tuple[int, int, int, int],
    output_path: str,
) -> None:
    """
    TEXCOORD 없이 깔끔한 GLB 파일을 직접 조립합니다.
    trimesh의 TextureVisuals가 불필요한 UV를 추가하는 문제 우회.
    POSITION + NORMAL + Material(baseColorFactor)만 포함.
    """
    import struct, json

    verts_f32 = vertices.astype(np.float32)
    norms_f32 = normals.astype(np.float32)
    indices_u32 = faces.flatten().astype(np.uint32)

    # 바이너리 버퍼 구성: indices | vertices | normals
    idx_bytes = indices_u32.tobytes()
    vtx_bytes = verts_f32.tobytes()
    nrm_bytes = norms_f32.tobytes()

    idx_len = len(idx_bytes)
    vtx_len = len(vtx_bytes)
    nrm_len = len(nrm_bytes)

    # 바운딩 박스
    v_min = verts_f32.min(axis=0).tolist()
    v_max = verts_f32.max(axis=0).tolist()

    base_color = [c / 255.0 for c in color[:4]]

    gltf_json = {
        "asset": {"version": "2.0", "generator": "building_cesium"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": "building_walls"}],
        "meshes": [{
            "primitives": [{
                "attributes": {"POSITION": 1, "NORMAL": 2},
                "indices": 0,
                "material": 0,
                "mode": 4,
            }]
        }],
        "materials": [{
            "pbrMetallicRoughness": {
                "baseColorFactor": base_color,
                "metallicFactor": 0.0,
                "roughnessFactor": 0.8,
            },
            "doubleSided": True,
        }],
        "accessors": [
            {  # 0: indices
                "bufferView": 0,
                "componentType": 5125,  # UNSIGNED_INT
                "count": len(indices_u32),
                "type": "SCALAR",
                "max": [int(indices_u32.max())],
                "min": [int(indices_u32.min())],
            },
            {  # 1: positions
                "bufferView": 1,
                "componentType": 5126,  # FLOAT
                "count": len(verts_f32),
                "type": "VEC3",
                "max": v_max,
                "min": v_min,
            },
            {  # 2: normals
                "bufferView": 2,
                "componentType": 5126,
                "count": len(norms_f32),
                "type": "VEC3",
            },
        ],
        "bufferViews": [
            {"buffer": 0, "byteOffset": 0, "byteLength": idx_len, "target": 34963},
            {"buffer": 0, "byteOffset": idx_len, "byteLength": vtx_len, "target": 34962},
            {"buffer": 0, "byteOffset": idx_len + vtx_len, "byteLength": nrm_len, "target": 34962},
        ],
        "buffers": [{"byteLength": idx_len + vtx_len + nrm_len}],
    }

    json_str = json.dumps(gltf_json, separators=(',', ':'))
    # JSON 청크는 4바이트 정렬 필요
    json_bytes = json_str.encode('utf-8')
    json_pad = (4 - len(json_bytes) % 4) % 4
    json_bytes += b' ' * json_pad

    bin_data = idx_bytes + vtx_bytes + nrm_bytes
    bin_pad = (4 - len(bin_data) % 4) % 4
    bin_data += b'\x00' * bin_pad

    # GLB 헤더 (12 bytes) + JSON 청크 (8 + len) + BIN 청크 (8 + len)
    total = 12 + 8 + len(json_bytes) + 8 + len(bin_data)

    with open(output_path, 'wb') as f:
        # GLB header
        f.write(struct.pack('<4sII', b'glTF', 2, total))
        # JSON chunk
        f.write(struct.pack('<I4s', len(json_bytes), b'JSON'))
        f.write(json_bytes)
        # BIN chunk
        f.write(struct.pack('<I4s', len(bin_data), b'BIN\x00'))
        f.write(bin_data)


def _apply_pbr_material(
    mesh: trimesh.Trimesh,
    color: Tuple[int, int, int, int] = (180, 180, 180, 255),
) -> None:
    """
    메쉬에 PBR 솔리드 컬러 머티리얼을 적용합니다.
    baseColorFactor만 사용 (텍스처 없음) → 깔끔한 단색 렌더링.
    UV를 전부 0으로 세팅하여 자동 생성 UV 아티팩트 방지.
    """
    base_color = [c / 255.0 for c in color[:4]]
    material = PBRMaterial(
        baseColorFactor=base_color,
        metallicFactor=0.0,
        roughnessFactor=0.8,
        doubleSided=True,
    )
    uv = np.zeros((len(mesh.vertices), 2), dtype=np.float64)
    mesh.visual = trimesh.visual.TextureVisuals(uv=uv, material=material)


def create_building_mesh(
    footprint: List[List[float]],
    height: float = 9.0,
    base_height: float = 0.0
) -> trimesh.Trimesh:
    """
    2D footprint를 3D 건물 메쉬로 변환 (extrusion)

    Args:
        footprint: 건물 바닥면 좌표 [[x, y], ...]
        height: 건물 높이 (m)
        base_height: 바닥 높이 (m)

    Returns:
        trimesh.Trimesh 객체
    """
    # footprint를 numpy 배열로 변환
    points_2d = np.array(footprint)

    # 2D 경로 생성
    path = trimesh.path.Path2D(
        entities=[trimesh.path.entities.Line(points=list(range(len(points_2d))) + [0])],
        vertices=points_2d
    )

    # 폴리곤으로 변환
    try:
        polygon = path.polygons_full[0]
    except (IndexError, Exception) as e:
        logger.warning(f"Path to polygon conversion failed: {e}")
        # 대안: shapely로 직접 폴리곤 생성
        from shapely.geometry import Polygon as ShapelyPolygon
        shapely_poly = ShapelyPolygon(footprint)
        polygon = shapely_poly

    # Extrusion으로 3D 메쉬 생성 (Z-up)
    mesh = trimesh.creation.extrude_polygon(
        polygon,
        height=height
    )

    # glTF 표준은 Y-up 이므로 Z-up → Y-up 변환 (X축 기준 +90° 회전)
    # [x, y, z] → [x, z, -y]
    rotation_matrix = np.array([
        [1,  0,  0, 0],
        [0,  0,  1, 0],
        [0, -1,  0, 0],
        [0,  0,  0, 1],
    ], dtype=np.float64)
    mesh.apply_transform(rotation_matrix)

    # 메쉬 정리: 중복 vertex 병합 + 법선 재계산
    mesh.merge_vertices()
    mesh.fix_normals()

    # 바닥 높이 조정 (Y-up 이므로 Y축으로 이동)
    if base_height != 0:
        mesh.apply_translation([0, base_height, 0])

    logger.info(f"Created building mesh: vertices={len(mesh.vertices)}, faces={len(mesh.faces)}")
    return mesh


def create_building_gltf(
    footprint: List[List[float]],
    height: float = 9.0,
    output_path: str = "building.glb",
    color: Optional[Tuple[int, int, int, int]] = None
) -> bool:
    """
    건물 매스를 glTF/GLB 파일로 내보내기

    Args:
        footprint: 건물 바닥면 좌표
        height: 건물 높이
        output_path: 출력 파일 경로 (.glb 또는 .gltf)
        color: RGBA 색상 (0-255)

    Returns:
        성공 여부
    """
    try:
        # 메쉬 생성
        mesh = create_building_mesh(footprint, height)

        # PBR 머티리얼 적용
        if color is None:
            color = (180, 180, 180, 255)  # 기본 회색
        _apply_pbr_material(mesh, color)

        # 메쉬를 Scene에 추가
        scene = trimesh.Scene()
        scene.add_geometry(mesh, node_name="building")

        # glTF/GLB로 내보내기
        if output_path.endswith('.glb'):
            scene.export(output_path, file_type='glb')
        else:
            scene.export(output_path, file_type='gltf')

        logger.info(f"Exported building model to: {output_path}")
        return True

    except Exception as e:
        logger.error(f"Failed to create glTF: {e}")
        return False


def create_multi_floor_building(
    footprint: List[List[float]],
    floors: int = 3,
    floor_height: float = 3.0,
    output_path: str = "building.glb"
) -> bool:
    """
    다층 건물 모델 생성 (층별 구분)

    Args:
        footprint: 건물 바닥면 좌표
        floors: 층수
        floor_height: 층고 (m)
        output_path: 출력 파일 경로

    Returns:
        성공 여부
    """
    try:
        scene = trimesh.Scene()

        # 층별 색상 (아래층일수록 어둡게)
        for floor_num in range(floors):
            base = floor_num * floor_height
            brightness = 120 + (floor_num * 20)
            brightness = min(brightness, 200)

            mesh = create_building_mesh(
                footprint,
                height=floor_height - 0.1,  # 층 사이 약간의 간격
                base_height=base
            )

            color = (brightness, brightness, brightness, 255)
            _apply_pbr_material(mesh, color)

            scene.add_geometry(mesh, node_name=f"floor_{floor_num + 1}")

        scene.export(output_path, file_type='glb')
        logger.info(f"Exported multi-floor building ({floors} floors) to: {output_path}")
        return True

    except Exception as e:
        logger.error(f"Failed to create multi-floor building: {e}")
        return False


def create_wall_building_gltf(
    dxf_path: str,
    wall_layers: List[str],
    height: float = 9.0,
    wall_thickness: float = 0.15,
    output_path: str = "building.glb",
    color: Optional[Tuple[int, int, int, int]] = None
) -> dict:
    """
    DXF 벽 레이어에서 실제 벽체 형태를 추출하여 3D GLB 생성

    LINE/LWPOLYLINE → buffer(wall_thickness) → extrude(height) → GLB

    Args:
        dxf_path: DXF 파일 경로
        wall_layers: 벽 레이어 이름 목록
        height: 벽 높이 (m)
        wall_thickness: 벽 두께 (m), 기본 0.15m
        output_path: 출력 GLB 경로
        color: RGBA 색상 (0-255)

    Returns:
        성공 여부
    """
    import ezdxf
    from shapely.geometry import LineString, MultiLineString, Polygon as ShapelyPolygon
    from shapely.ops import unary_union

    steps = []  # 중간 변환 과정 기록

    try:
        doc = ezdxf.readfile(dxf_path)
        msp = doc.modelspace()
        steps.append({"label": "DXF 파일 읽기", "detail": f"레이어: {', '.join(wall_layers)}"})

        # DXF 단위 판별: $INSUNITS (4=mm, 5=cm, 6=m) 또는 좌표 범위로 추정
        dxf_scale = 1.0  # 기본: 미터
        try:
            insunits = doc.header.get('$INSUNITS', 0)
            if insunits == 4:  # mm
                dxf_scale = 0.001
                logger.info("DXF units: mm (INSUNITS=4), applying scale 0.001")
            elif insunits == 5:  # cm
                dxf_scale = 0.01
                logger.info("DXF units: cm (INSUNITS=5), applying scale 0.01")
            elif insunits == 6:  # m
                dxf_scale = 1.0
                logger.info("DXF units: m (INSUNITS=6)")
            else:
                logger.info(f"DXF INSUNITS={insunits}, will auto-detect from coordinate range")
        except Exception:
            logger.info("No $INSUNITS header, will auto-detect from coordinate range")

        # 1) 벽 레이어에서 모든 LINE / LWPOLYLINE 추출
        geom_lines = []
        for entity in msp:
            if entity.dxf.layer not in wall_layers:
                continue
            if entity.dxftype() == 'LINE':
                s = (entity.dxf.start[0], entity.dxf.start[1])
                e = (entity.dxf.end[0], entity.dxf.end[1])
                if s != e:
                    geom_lines.append(LineString([s, e]))
            elif entity.dxftype() == 'LWPOLYLINE':
                pts = [(p[0], p[1]) for p in entity.get_points()]
                if len(pts) >= 2:
                    if entity.closed and pts[0] != pts[-1]:
                        pts.append(pts[0])
                    geom_lines.append(LineString(pts))
            elif entity.dxftype() == 'POLYLINE':
                pts = [(v.dxf.location[0], v.dxf.location[1]) for v in entity.vertices]
                if len(pts) >= 2:
                    geom_lines.append(LineString(pts))

        if not geom_lines:
            logger.error(f"No wall geometry found on layers {wall_layers}")
            return {"success": False, "error": "벽 레이어에서 도형을 찾을 수 없습니다", "steps": steps}

        steps.append({"label": "벽 선분 추출", "detail": f"{len(geom_lines)}개 LINE/POLYLINE 추출"})
        logger.info(f"Extracted {len(geom_lines)} wall line segments from layers {wall_layers}")

        # $INSUNITS가 불명확할 때 좌표 범위로 mm 여부 자동 판별
        if dxf_scale == 1.0:
            all_bounds = unary_union(geom_lines).bounds  # (minx, miny, maxx, maxy)
            extent = max(all_bounds[2] - all_bounds[0], all_bounds[3] - all_bounds[1])
            if extent > 500:  # 500 이상이면 mm 단위로 추정 (일반 건물 <200m)
                dxf_scale = 0.001
                logger.info(f"Auto-detected mm units: extent={extent:.0f}, applying scale 0.001")
            else:
                logger.info(f"Coordinate extent={extent:.1f}, assuming meters")

        # 2) 스케일 변환
        if dxf_scale != 1.0:
            scaled_lines = []
            for line in geom_lines:
                coords = [(x * dxf_scale, y * dxf_scale) for x, y in line.coords]
                scaled_lines.append(LineString(coords))
            geom_lines = scaled_lines
            logger.info(f"Scaled {len(geom_lines)} lines by {dxf_scale}")

        # 3) 중심점 계산 (원본 선분 좌표에서)
        all_xs, all_ys = [], []
        for line in geom_lines:
            for x, y in line.coords:
                all_xs.append(x)
                all_ys.append(y)
        cx = (min(all_xs) + max(all_xs)) / 2
        cy = (min(all_ys) + max(all_ys)) / 2

        # 4) 원본 선분 → 원점 기준 세그먼트
        segments = []
        for line in geom_lines:
            coords = list(line.coords)
            for i in range(len(coords) - 1):
                x1, y1 = coords[i][0] - cx, coords[i][1] - cy
                x2, y2 = coords[i+1][0] - cx, coords[i+1][1] - cy
                if abs(x1 - x2) > 0.001 or abs(y1 - y2) > 0.001:  # 길이 0 제거
                    segments.append(((x1, y1), (x2, y2)))

        steps.append({"label": "벽 선분 추출", "detail": f"{len(segments)}개 선분 → 원점 기준 정규화"})

        if not segments:
            return {"success": False, "error": "유효한 선분 없음", "steps": steps}

        # 5) 각 선분 → 수직 quad (4 vertices, 2 faces)
        #    캡 없음 — 선분을 그대로 수직으로 세움
        all_vertices = []
        all_faces = []

        for (x1, y1), (x2, y2) in segments:
            idx = len(all_vertices)
            all_vertices.extend([
                [x1, y1, 0],
                [x2, y2, 0],
                [x2, y2, height],
                [x1, y1, height],
            ])
            all_faces.append([idx, idx+1, idx+2])
            all_faces.append([idx, idx+2, idx+3])

        steps.append({"label": "벽면 Quad 생성", "detail": f"{len(segments)}개 벽면 × 2 삼각형 = {len(all_faces)}개 면"})

        # 6) 좌표 변환: Z-up → Y-up  [x, y, z] → [x, z, -y]
        verts = np.array(all_vertices, dtype=np.float32)
        faces_np = np.array(all_faces, dtype=np.uint32)

        # Z-up → Y-up 변환
        verts_yup = np.column_stack([verts[:, 0], verts[:, 2], -verts[:, 1]])

        # 법선 계산: face cross product → 정점에 할당
        face_n = np.cross(
            verts_yup[faces_np[:, 1]] - verts_yup[faces_np[:, 0]],
            verts_yup[faces_np[:, 2]] - verts_yup[faces_np[:, 0]],
        )
        fn_len = np.linalg.norm(face_n, axis=1, keepdims=True)
        fn_len[fn_len < 1e-10] = 1.0
        face_n = face_n / fn_len
        normals = np.zeros_like(verts_yup)
        for i, face in enumerate(faces_np):
            for vi in face:
                normals[vi] = face_n[i]

        if color is None:
            color = (200, 200, 200, 255)

        steps.append({"label": "메쉬 완성", "detail": f"정점 {len(verts_yup)}개, 면 {len(faces_np)}개"})

        # 7) GLB 직접 조립 (trimesh 우회) — TEXCOORD 없이 깔끔한 glTF
        _export_clean_glb(verts_yup, faces_np, normals, color, output_path)

        import os
        file_size_kb = os.path.getsize(output_path) / 1024
        steps.append({"label": "GLB 파일 저장", "detail": f"{file_size_kb:.1f} KB"})

        logger.info(f"Exported wall building: {len(verts_yup)} vertices, "
                     f"{len(faces_np)} faces → {output_path}")
        return {"success": True, "steps": steps}

    except Exception as e:
        logger.error(f"Failed to create wall GLB: {e}")
        return {"success": False, "error": str(e), "steps": steps}


def normalize_footprint_to_origin(footprint: List[List[float]]) -> Tuple[List[List[float]], Tuple[float, float]]:
    """
    footprint를 원점 기준으로 정규화

    Args:
        footprint: 원본 좌표

    Returns:
        (정규화된 좌표, 원래 중심점)
    """
    points = np.array(footprint)
    centroid = points.mean(axis=0)

    normalized = points - centroid
    normalized_list = normalized.tolist()

    return normalized_list, (centroid[0], centroid[1])


def footprint_to_cesium_coordinates(
    footprint: List[List[float]],
    origin_lon: float,
    origin_lat: float,
    scale: float = 1.0
) -> List[List[float]]:
    """
    로컬 좌표를 Cesium 좌표(경위도)로 변환

    Args:
        footprint: 로컬 좌표 (미터 단위)
        origin_lon: 원점 경도
        origin_lat: 원점 위도
        scale: 스케일 팩터

    Returns:
        경위도 좌표 리스트
    """
    # 대략적인 변환 (1도 ≈ 111km at equator)
    # 더 정확한 변환은 pyproj 사용
    lat_per_meter = 1.0 / 111000.0
    lon_per_meter = 1.0 / (111000.0 * np.cos(np.radians(origin_lat)))

    result = []
    for x, y in footprint:
        lon = origin_lon + (x * scale * lon_per_meter)
        lat = origin_lat + (y * scale * lat_per_meter)
        result.append([lon, lat])

    return result
