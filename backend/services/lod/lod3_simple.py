"""
LOD3 Simple — LOD1 방식 기반 + 문/창문 색상 표시.

LOD1과 동일하게 벽 선분을 수직 quad로 생성하되,
문/창문 레이어에서 추출한 개구부를 별도 색상으로 표시.

- 벽: 회색 (200, 200, 200)
- 문: 주황색 (255, 140, 0)
- 창문: 하늘색 (135, 206, 250)
"""

import logging
import os
from typing import List, Tuple, Optional, Dict, Any
import numpy as np

logger = logging.getLogger(__name__)

# 색상 정의 (RGBA, 알파 255=불투명, 128=반투명)
WALL_COLOR = (200, 200, 200, 255)      # 회색 (불투명)
DOOR_COLOR = (255, 120, 0, 200)        # 진한 주황색 (반투명)
WINDOW_COLOR = (0, 180, 255, 180)      # 선명한 하늘색 (반투명)
ROOF_COLOR = (180, 180, 180, 255)      # 연한 회색 (불투명)

# 기초 높이 (지면에서 1층 바닥까지)
FOUNDATION_HEIGHT = 0.5


def _extract_lines_from_layer(msp, layers: List[str], dxf_scale: float = 1.0) -> List[Tuple[Tuple[float, float], Tuple[float, float]]]:
    """레이어에서 LINE/LWPOLYLINE 추출하여 선분 리스트 반환."""
    from shapely.geometry import LineString

    geom_lines = []
    for entity in msp:
        if entity.dxf.layer not in layers:
            continue
        if entity.dxftype() == 'LINE':
            s = (entity.dxf.start[0] * dxf_scale, entity.dxf.start[1] * dxf_scale)
            e = (entity.dxf.end[0] * dxf_scale, entity.dxf.end[1] * dxf_scale)
            if s != e:
                geom_lines.append(LineString([s, e]))
        elif entity.dxftype() == 'LWPOLYLINE':
            pts = [(p[0] * dxf_scale, p[1] * dxf_scale) for p in entity.get_points()]
            if len(pts) >= 2:
                if entity.closed and pts[0] != pts[-1]:
                    pts.append(pts[0])
                geom_lines.append(LineString(pts))
        elif entity.dxftype() == 'POLYLINE':
            pts = [(v.dxf.location[0] * dxf_scale, v.dxf.location[1] * dxf_scale) for v in entity.vertices]
            if len(pts) >= 2:
                geom_lines.append(LineString(pts))

    # LineString → 선분 리스트
    segments = []
    for line in geom_lines:
        coords = list(line.coords)
        for i in range(len(coords) - 1):
            x1, y1 = coords[i]
            x2, y2 = coords[i + 1]
            if abs(x1 - x2) > 0.001 or abs(y1 - y2) > 0.001:
                segments.append(((x1, y1), (x2, y2)))

    return segments


def _extract_inserts_from_layer(msp, layers: List[str], dxf_scale: float = 1.0) -> List[Tuple[float, float]]:
    """레이어에서 INSERT(블록 참조) 위치 추출."""
    positions = []
    for entity in msp:
        if entity.dxf.layer not in layers:
            continue
        if entity.dxftype() == 'INSERT':
            pos = entity.dxf.insert
            positions.append((pos[0] * dxf_scale, pos[1] * dxf_scale))
    return positions


def _extract_door_rectangles(msp, layers: List[str], dxf_scale: float = 1.0) -> List[Tuple[float, float, float, float, float]]:
    """문 레이어에서 닫힌 문 사각형 추출.

    ARC(문 스윙 호)를 사용하여 문 위치와 폭을 결정:
    - ARC center = 문 힌지 위치
    - ARC radius = 문 폭
    - ARC angle = 문 방향

    Returns:
        [(cx, cy, width, height, angle), ...] - 문 중심, 크기, 회전각(도)
    """
    import math

    doors = []
    for entity in msp:
        if entity.dxf.layer not in layers:
            continue

        # ARC를 사용하여 문 위치/크기 결정
        if entity.dxftype() == 'ARC':
            center = entity.dxf.center
            radius = entity.dxf.radius * dxf_scale
            start_angle = entity.dxf.start_angle  # 도
            end_angle = entity.dxf.end_angle

            # 문 폭 = 반지름
            door_width = radius
            door_height = 2.1  # 표준 문 높이

            # 닫힌 문 위치 = start_angle 또는 end_angle (벽에 붙은 위치)
            # 보통 start_angle이 닫힌 위치
            closed_angle = start_angle

            # 문 중심 계산 (힌지에서 문 폭의 절반만큼 이동)
            angle_rad = math.radians(closed_angle)
            door_cx = center[0] * dxf_scale + (door_width / 2) * math.cos(angle_rad)
            door_cy = center[1] * dxf_scale + (door_width / 2) * math.sin(angle_rad)

            # 문 패널 각도 = 닫힌 위치 방향
            panel_angle = closed_angle

            doors.append((door_cx, door_cy, door_width, door_height, panel_angle))

    return doors


def _detect_dxf_scale(msp) -> float:
    """DXF 좌표 범위로 스케일 자동 감지.

    LOD1 (gltf_exporter.py)와 동일한 로직 사용.
    """
    xs, ys = [], []
    for ent in msp:
        et = ent.dxftype()
        if et == 'LINE':
            xs.extend([ent.dxf.start[0], ent.dxf.end[0]])
            ys.extend([ent.dxf.start[1], ent.dxf.end[1]])
        elif et == 'LWPOLYLINE':
            for p in ent.get_points():
                xs.append(p[0])
                ys.append(p[1])
        elif et == 'POLYLINE':
            for v in ent.vertices:
                xs.append(v.dxf.location[0])
                ys.append(v.dxf.location[1])

    if not xs or not ys:
        return 1.0

    extent = max(max(xs) - min(xs), max(ys) - min(ys))
    logger.info(f"DXF extent: {extent:.2f}")

    # 500 이상: 확실히 mm 단위 (일반 건물 <200m)
    if extent > 500:
        logger.info(f"Auto-detected mm units: extent={extent:.0f}")
        return 0.001

    # 200~500: 애매한 구간, m 또는 mm 가능
    # 200m 건물은 드물지만 mm로 200~500이면 20~50cm로 너무 작음
    # → m로 가정
    if extent > 200:
        logger.info(f"Assuming meters: extent={extent:.1f}m (200-500 range)")
        return 1.0

    # 5~200: 합리적인 건물 크기 범위 (5m~200m)
    if extent >= 5:
        logger.info(f"Assuming meters: extent={extent:.1f}m")
        return 1.0

    # 1~5: feet 단위 가능성 (1ft=0.3m, 5ft=1.5m)
    if extent >= 1:
        converted = extent * 0.3048
        if 0.3 < converted < 100:
            logger.info(f"Auto-detected feet: extent={extent:.2f}ft → {converted:.2f}m")
            return 0.3048
        return 1.0

    # 0.1~1: 축척 도면 가능성 (1:100)
    if extent >= 0.1:
        scaled = extent * 100
        if 5 < scaled < 200:
            logger.info(f"Auto-detected 1:100 scale: extent={extent:.3f} → {scaled:.1f}m")
            return 100.0
        return 1.0

    # 0.1 미만: 1:1000 축척 또는 매우 작은 도면
    scaled = extent * 1000
    if 5 < scaled < 500:
        logger.info(f"Auto-detected 1:1000 scale: extent={extent:.4f} → {scaled:.1f}m")
        return 1000.0

    logger.info(f"Using default scale 1.0: extent={extent}")
    return 1.0


def _door_rects_to_panels(
    rectangles: List[Tuple[float, float, float, float, float]],
    cx: float, cy: float,
    door_height: float = 2.1,
    thickness: float = 0.05
) -> Tuple[List[List[float]], List[List[int]]]:
    """문 사각형을 단순 quad 패널로 변환.

    Args:
        rectangles: [(door_cx, door_cy, width, height, angle_deg), ...]
        cx, cy: 전체 모델 중심점
        door_height: 문 높이
        thickness: 문 두께 (사용 안함, 단순 quad)

    Returns:
        (vertices, faces)
    """
    import math

    vertices = []
    faces = []

    for (dx, dy, width, dh, angle_deg) in rectangles:
        # 중심점 기준 정규화
        dx, dy = dx - cx, dy - cy

        hw = width / 2  # 반폭

        # 각도를 라디안으로 변환
        angle_rad = math.radians(angle_deg)
        cos_a = math.cos(angle_rad)
        sin_a = math.sin(angle_rad)

        # 선분 양 끝점 (문 폭 방향)
        x1 = dx - hw * cos_a
        y1 = dy - hw * sin_a
        x2 = dx + hw * cos_a
        y2 = dy + hw * sin_a

        # 기초 높이(0.5m)에서 시작
        base_z = FOUNDATION_HEIGHT
        top_z = base_z + door_height

        # 단순 quad (4정점, 2삼각형) - 기존 벽체와 동일
        idx = len(vertices)
        vertices.extend([
            [x1, y1, base_z],
            [x2, y2, base_z],
            [x2, y2, top_z],
            [x1, y1, top_z],
        ])
        faces.append([idx, idx + 1, idx + 2])
        faces.append([idx, idx + 2, idx + 3])

    return vertices, faces


def _create_opening_wall_sections(
    openings: List[Tuple[float, float, float, float, float]],
    cx: float, cy: float,
    opening_type: str,  # 'door' or 'window'
    building_height: float
) -> Tuple[List[List[float]], List[List[int]]]:
    """개구부 주변 벽체 생성 (단순 quad 방식 - 기존 벽체와 동일 + 상단면).

    문: 위쪽 벽체만 (door_top ~ building_height)
    창문: 아래 벽체 (foundation ~ sill) + 위쪽 벽체 (window_top ~ building_height)

    Args:
        openings: [(cx, cy, width, height, angle_deg), ...]
        cx, cy: 모델 중심점
        opening_type: 'door' 또는 'window'
        building_height: 건물 높이

    Returns:
        (vertices, faces)
    """
    import math

    vertices = []
    faces = []

    # 기초 높이 적용
    foundation_z = FOUNDATION_HEIGHT  # 0.5m

    # 개구부 치수 설정
    if opening_type == 'door':
        opening_height = 2.1
        sill_height = 0.0  # 문은 바닥에서 시작
    else:  # window
        opening_height = 1.2  # 창문 높이
        sill_height = 0.8  # 창턱 높이 (기초 위에서)

    for (ox, oy, width, _, angle_deg) in openings:
        # 중심점 기준 정규화
        ox, oy = ox - cx, oy - cy

        hw = width / 2
        angle_rad = math.radians(angle_deg)
        cos_a = math.cos(angle_rad)
        sin_a = math.sin(angle_rad)

        # 선분 양 끝점 계산 (개구부 폭 방향)
        x1 = ox - hw * cos_a
        y1 = oy - hw * sin_a
        x2 = ox + hw * cos_a
        y2 = oy + hw * sin_a

        def add_wall_quad(z_bottom: float, z_top: float):
            """벽체 quad 추가 (상단면 별도 처리)"""
            if z_top <= z_bottom + 0.05:
                return

            idx = len(vertices)
            # 전면 quad (4개 정점)
            vertices.extend([
                [x1, y1, z_bottom],
                [x2, y2, z_bottom],
                [x2, y2, z_top],
                [x1, y1, z_top],
            ])
            # 전면 삼각형 2개
            faces.append([idx, idx + 1, idx + 2])
            faces.append([idx, idx + 2, idx + 3])

        def add_lintel_cap(z_height: float):
            """개구부 위 덮개 (lintel) 추가 - 문/창문 바로 위"""
            t = 0.02  # 메인 지붕과 동일한 두께
            # 수직 방향 (angle + 90도)
            nx = -sin_a * t
            ny = cos_a * t

            cap_idx = len(vertices)
            vertices.extend([
                [x1 - nx, y1 - ny, z_height],
                [x2 - nx, y2 - ny, z_height],
                [x2 + nx, y2 + ny, z_height],
                [x1 + nx, y1 + ny, z_height],
            ])
            faces.append([cap_idx, cap_idx + 1, cap_idx + 2])
            faces.append([cap_idx, cap_idx + 2, cap_idx + 3])

        if opening_type == 'door':
            # 문 위쪽 벽체 (문 상단 ~ 건물 높이)
            door_top = foundation_z + opening_height  # 0.5 + 2.1 = 2.6m
            add_wall_quad(door_top, building_height)
            # 문 바로 위 덮개 (lintel) - 2.6m 높이
            add_lintel_cap(door_top)
            # 문 위쪽 벽체 상단 덮개 - 건물 높이
            add_lintel_cap(building_height)
        else:
            # 창문 아래 벽체 (기초 ~ 창턱)
            sill_top = foundation_z + sill_height  # 0.5 + 0.8 = 1.3m
            add_wall_quad(foundation_z, sill_top)
            # 창턱 덮개 (sill) - 1.3m 높이
            add_lintel_cap(sill_top)

            # 창문 위쪽 벽체 (창문 상단 ~ 건물 높이)
            window_top = foundation_z + sill_height + opening_height  # 0.5 + 0.8 + 1.2 = 2.5m
            add_wall_quad(window_top, building_height)
            # 창문 바로 위 덮개 (lintel) - 2.5m 높이
            add_lintel_cap(window_top)
            # 창문 위쪽 벽체 상단 덮개 - 건물 높이
            add_lintel_cap(building_height)

    return vertices, faces


def _segments_to_quads(
    segments: List[Tuple[Tuple[float, float], Tuple[float, float]]],
    cx: float, cy: float,
    height: float,
    base_z: float = 0.0
) -> Tuple[List[List[float]], List[List[int]]]:
    """선분 리스트를 수직 quad로 변환."""
    vertices = []
    faces = []

    for (x1, y1), (x2, y2) in segments:
        # 중심점 기준 정규화
        x1, y1 = x1 - cx, y1 - cy
        x2, y2 = x2 - cx, y2 - cy

        idx = len(vertices)
        vertices.extend([
            [x1, y1, base_z],
            [x2, y2, base_z],
            [x2, y2, base_z + height],
            [x1, y1, base_z + height],
        ])
        faces.append([idx, idx + 1, idx + 2])
        faces.append([idx, idx + 2, idx + 3])

    return vertices, faces


def _inserts_to_quads(
    positions: List[Tuple[float, float]],
    cx: float, cy: float,
    width: float,
    height: float,
    base_z: float = 0.0
) -> Tuple[List[List[float]], List[List[int]]]:
    """INSERT 위치를 정사각형 quad로 변환."""
    vertices = []
    faces = []
    half_w = width / 2

    for (x, y) in positions:
        # 중심점 기준 정규화
        x, y = x - cx, y - cy

        idx = len(vertices)
        # 정사각형 quad (문/창문 표시용)
        vertices.extend([
            [x - half_w, y, base_z],
            [x + half_w, y, base_z],
            [x + half_w, y, base_z + height],
            [x - half_w, y, base_z + height],
        ])
        faces.append([idx, idx + 1, idx + 2])
        faces.append([idx, idx + 2, idx + 3])

    return vertices, faces


def _create_roof_from_segments(
    segments: List[Tuple[Tuple[float, float], Tuple[float, float]]],
    cx: float, cy: float,
    z: float,
    thickness: float = 0.02  # 최소 두께 (벽 밖으로 튀어나오지 않게)
) -> Tuple[List[List[float]], List[List[int]]]:
    """벽 선분에서 지붕(상단 면) 생성.

    벽 선분들을 아주 작은 buffer로 확장하여 폴리곤을 만들고,
    trimesh를 사용하여 삼각화.
    """
    from shapely.geometry import LineString
    from shapely.ops import unary_union
    import trimesh

    # 선분들을 최소 buffer로 확장하여 폴리곤 생성 (벽 밖으로 거의 튀어나오지 않음)
    buffered = []
    for (x1, y1), (x2, y2) in segments:
        line = LineString([(x1 - cx, y1 - cy), (x2 - cx, y2 - cy)])
        buf = line.buffer(thickness / 2, cap_style=2)  # flat ends, 최소 버퍼
        if not buf.is_empty:
            buffered.append(buf)

    if not buffered:
        return [], []

    # 모든 버퍼 합치기
    merged = unary_union(buffered)

    # 폴리곤 또는 멀티폴리곤에서 외곽 좌표 추출
    polygons = []
    if merged.geom_type == 'Polygon':
        polygons = [merged]
    elif merged.geom_type == 'MultiPolygon':
        polygons = list(merged.geoms)
    else:
        return [], []

    vertices = []
    faces = []

    for poly in polygons:
        if poly.is_empty or not poly.is_valid:
            continue

        try:
            # trimesh의 extrude_polygon으로 얇은 슬래브 생성 후 상단 면만 추출
            # 또는 직접 삼각화
            from trimesh.creation import extrude_polygon

            # 아주 얇은 높이로 압출 (0.01m)
            mesh = extrude_polygon(poly, height=0.01)

            # 상단 면의 정점만 추출 (z가 최대인 정점들)
            max_z = mesh.vertices[:, 2].max()
            top_mask = mesh.vertices[:, 2] >= max_z - 0.001

            # 상단 면 인덱스
            top_indices = np.where(top_mask)[0]
            if len(top_indices) < 3:
                continue

            # 상단 면에 해당하는 face 찾기
            top_faces = []
            for face in mesh.faces:
                if all(top_mask[v] for v in face):
                    top_faces.append(face)

            if not top_faces:
                continue

            # 정점을 새 리스트에 추가 (z를 원하는 높이로 조정)
            base_idx = len(vertices)
            idx_map = {}
            for i, old_idx in enumerate(top_indices):
                v = mesh.vertices[old_idx]
                vertices.append([v[0], v[1], z])
                idx_map[old_idx] = base_idx + i

            # 면 인덱스 재매핑
            for face in top_faces:
                new_face = [idx_map[v] for v in face if v in idx_map]
                if len(new_face) == 3:
                    faces.append(new_face)

        except Exception as e:
            logger.debug(f"지붕 삼각화 실패: {e}")
            continue

    return vertices, faces


def _compute_normals(verts: np.ndarray, faces: np.ndarray) -> np.ndarray:
    """면 법선 계산."""
    face_n = np.cross(
        verts[faces[:, 1]] - verts[faces[:, 0]],
        verts[faces[:, 2]] - verts[faces[:, 0]],
    )
    fn_len = np.linalg.norm(face_n, axis=1, keepdims=True)
    fn_len[fn_len < 1e-10] = 1.0
    face_n = face_n / fn_len

    normals = np.zeros_like(verts)
    for i, face in enumerate(faces):
        for vi in face:
            normals[vi] = face_n[i]

    return normals


def _export_multi_mesh_glb(
    meshes: List[Tuple[np.ndarray, np.ndarray, Tuple[int, int, int, int], str]],
    output_path: str
) -> Dict[str, Any]:
    """여러 메쉬를 하나의 GLB로 내보내기.

    Args:
        meshes: [(vertices, faces, color, name), ...]
        output_path: 출력 경로

    Returns:
        메쉬 통계
    """
    import struct
    import json

    # 모든 메쉬 통합
    all_primitives = []
    total_vertices = 0
    total_faces = 0
    byte_offset = 0
    all_buffers = b''

    for verts, faces, color, name in meshes:
        if len(verts) == 0 or len(faces) == 0:
            continue

        verts = np.array(verts, dtype=np.float32)
        faces = np.array(faces, dtype=np.uint32)

        # Z-up → Y-up 변환
        verts_yup = np.column_stack([verts[:, 0], verts[:, 2], -verts[:, 1]])

        # 법선 계산
        normals = _compute_normals(verts_yup, faces)

        # 바이너리 버퍼
        pos_bytes = verts_yup.astype(np.float32).tobytes()
        norm_bytes = normals.astype(np.float32).tobytes()
        idx_bytes = faces.flatten().astype(np.uint32).tobytes()

        # 패딩 (4바이트 정렬)
        def pad4(data):
            remainder = len(data) % 4
            if remainder:
                data += b'\x00' * (4 - remainder)
            return data

        pos_bytes = pad4(pos_bytes)
        norm_bytes = pad4(norm_bytes)
        idx_bytes = pad4(idx_bytes)

        # Accessor bounds
        pos_min = verts_yup.min(axis=0).tolist()
        pos_max = verts_yup.max(axis=0).tolist()

        all_primitives.append({
            'verts': verts_yup,
            'normals': normals,
            'faces': faces,
            'color': color,
            'name': name,
            'pos_bytes': pos_bytes,
            'norm_bytes': norm_bytes,
            'idx_bytes': idx_bytes,
            'pos_min': pos_min,
            'pos_max': pos_max,
            'byte_offset': byte_offset,
        })

        all_buffers += pos_bytes + norm_bytes + idx_bytes
        byte_offset += len(pos_bytes) + len(norm_bytes) + len(idx_bytes)
        total_vertices += len(verts)
        total_faces += len(faces)

    if not all_primitives:
        return {'primitives': 0, 'vertices': 0, 'faces': 0}

    # glTF JSON 구성
    accessors = []
    buffer_views = []
    meshes_json = []
    materials = []
    nodes = []

    bv_idx = 0
    acc_idx = 0

    for i, prim in enumerate(all_primitives):
        # Buffer views
        offset = prim['byte_offset']

        # Position buffer view
        buffer_views.append({
            'buffer': 0,
            'byteOffset': offset,
            'byteLength': len(prim['pos_bytes']),
            'target': 34962  # ARRAY_BUFFER
        })
        pos_bv = bv_idx
        bv_idx += 1
        offset += len(prim['pos_bytes'])

        # Normal buffer view
        buffer_views.append({
            'buffer': 0,
            'byteOffset': offset,
            'byteLength': len(prim['norm_bytes']),
            'target': 34962
        })
        norm_bv = bv_idx
        bv_idx += 1
        offset += len(prim['norm_bytes'])

        # Index buffer view
        buffer_views.append({
            'buffer': 0,
            'byteOffset': offset,
            'byteLength': len(prim['idx_bytes']),
            'target': 34963  # ELEMENT_ARRAY_BUFFER
        })
        idx_bv = bv_idx
        bv_idx += 1

        # Accessors
        # Position
        accessors.append({
            'bufferView': pos_bv,
            'componentType': 5126,  # FLOAT
            'count': len(prim['verts']),
            'type': 'VEC3',
            'min': prim['pos_min'],
            'max': prim['pos_max'],
        })
        pos_acc = acc_idx
        acc_idx += 1

        # Normal
        accessors.append({
            'bufferView': norm_bv,
            'componentType': 5126,
            'count': len(prim['normals']),
            'type': 'VEC3',
        })
        norm_acc = acc_idx
        acc_idx += 1

        # Index
        accessors.append({
            'bufferView': idx_bv,
            'componentType': 5125,  # UNSIGNED_INT
            'count': len(prim['faces']) * 3,
            'type': 'SCALAR',
        })
        idx_acc = acc_idx
        acc_idx += 1

        # Material
        r, g, b, a = prim['color']
        materials.append({
            'name': f"{prim['name']}_material",
            'pbrMetallicRoughness': {
                'baseColorFactor': [r/255, g/255, b/255, a/255],
                'metallicFactor': 0.0,
                'roughnessFactor': 0.8,
            },
            'alphaMode': 'OPAQUE' if a == 255 else 'BLEND',
            'doubleSided': True,  # 양면 렌더링 (백페이스 컬링 비활성화)
        })

        # Mesh
        meshes_json.append({
            'name': prim['name'],
            'primitives': [{
                'attributes': {
                    'POSITION': pos_acc,
                    'NORMAL': norm_acc,
                },
                'indices': idx_acc,
                'material': i,
            }]
        })

        # Node
        nodes.append({
            'name': prim['name'],
            'mesh': i,
        })

    # Scene
    gltf = {
        'asset': {'version': '2.0', 'generator': 'LOD3-Simple'},
        'scene': 0,
        'scenes': [{'nodes': list(range(len(nodes)))}],
        'nodes': nodes,
        'meshes': meshes_json,
        'materials': materials,
        'accessors': accessors,
        'bufferViews': buffer_views,
        'buffers': [{'byteLength': len(all_buffers)}],
    }

    # GLB 조립
    gltf_json = json.dumps(gltf, separators=(',', ':')).encode('utf-8')
    # JSON 패딩 (4바이트 정렬)
    while len(gltf_json) % 4:
        gltf_json += b' '

    # GLB 헤더
    glb_header = struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(gltf_json) + 8 + len(all_buffers))
    json_chunk = struct.pack('<I4s', len(gltf_json), b'JSON') + gltf_json
    bin_chunk = struct.pack('<I4s', len(all_buffers), b'BIN\x00') + all_buffers

    with open(output_path, 'wb') as f:
        f.write(glb_header + json_chunk + bin_chunk)

    return {
        'primitives': len(all_primitives),
        'vertices': total_vertices,
        'faces': total_faces,
        'file_size_kb': os.path.getsize(output_path) / 1024,
    }


def build_lod3_simple(
    dxf_path: str,
    wall_layers: List[str],
    door_layers: List[str],
    window_layers: List[str],
    height: float = 4.0,
    output_path: str = "building_lod3.glb",
    bounds: Optional[Dict[str, float]] = None  # {"min_x", "max_x", "min_y", "max_y"}
) -> Optional[Dict[str, Any]]:
    """LOD3 Simple 빌드 — LOD1 방식 + 문/창문 색상.

    Args:
        dxf_path: DXF 파일 경로
        wall_layers: 벽 레이어 목록
        door_layers: 문 레이어 목록
        window_layers: 창문 레이어 목록
        height: 건물 높이 (m)
        output_path: 출력 GLB 경로
        bounds: 범위 필터 (선택) - min_x, max_x, min_y, max_y

    Returns:
        성공 시 {"success": True, "mesh_stats": {...}, "steps": [...]}
        실패 시 None
    """
    import ezdxf

    try:
        doc = ezdxf.readfile(dxf_path)
        msp = doc.modelspace()
    except Exception as e:
        logger.error(f"DXF 파일 읽기 실패: {e}")
        return None

    steps = []
    steps.append({"label": "DXF 파일 읽기", "detail": os.path.basename(dxf_path)})

    # 스케일 감지
    dxf_scale = _detect_dxf_scale(msp)
    logger.info(f"DXF scale: {dxf_scale}")

    # 범위 필터링 함수
    def in_bounds(x: float, y: float) -> bool:
        if not bounds:
            return True
        return (bounds.get("min_x", float("-inf")) <= x <= bounds.get("max_x", float("inf")) and
                bounds.get("min_y", float("-inf")) <= y <= bounds.get("max_y", float("inf")))

    def filter_segments(segments):
        if not bounds:
            return segments
        return [((x1, y1), (x2, y2)) for (x1, y1), (x2, y2) in segments
                if in_bounds((x1 + x2) / 2, (y1 + y2) / 2)]

    def filter_positions(positions):
        if not bounds:
            return positions
        return [(x, y) for x, y in positions if in_bounds(x, y)]

    def filter_rectangles(rects):
        if not bounds:
            return rects
        return [(cx, cy, w, h, a) for cx, cy, w, h, a in rects if in_bounds(cx, cy)]

    # 1. 벽 선분 추출
    wall_segments = _extract_lines_from_layer(msp, wall_layers, dxf_scale)
    wall_segments = filter_segments(wall_segments)
    if not wall_segments:
        logger.error(f"벽 레이어에서 선분을 찾을 수 없음: {wall_layers}")
        return None
    steps.append({"label": "벽 선분 추출", "detail": f"{len(wall_segments)}개"})

    # 2. 문 추출 (닫힌 문 사각형으로 변환, ARC 제외)
    door_rectangles = _extract_door_rectangles(msp, door_layers, dxf_scale)
    door_rectangles = filter_rectangles(door_rectangles)
    door_inserts = _extract_inserts_from_layer(msp, door_layers, dxf_scale)
    door_inserts = filter_positions(door_inserts)

    # 3. 창문 추출 (LINE/INSERT)
    window_segments = _extract_lines_from_layer(msp, window_layers, dxf_scale)
    window_segments = filter_segments(window_segments)
    window_inserts = _extract_inserts_from_layer(msp, window_layers, dxf_scale)
    window_inserts = filter_positions(window_inserts)

    if bounds:
        steps.append({"label": "범위 필터", "detail": f"X:{bounds.get('min_x'):.1f}~{bounds.get('max_x'):.1f}, Y:{bounds.get('min_y'):.1f}~{bounds.get('max_y'):.1f}"})

    steps.append({"label": "문 추출", "detail": f"닫힌 문 {len(door_rectangles)}개, INSERT {len(door_inserts)}개"})
    steps.append({"label": "창문 추출", "detail": f"선분 {len(window_segments)}개, INSERT {len(window_inserts)}개"})

    # 3. 중심점 계산
    all_xs, all_ys = [], []
    for (x1, y1), (x2, y2) in wall_segments:
        all_xs.extend([x1, x2])
        all_ys.extend([y1, y2])
    cx = (min(all_xs) + max(all_xs)) / 2
    cy = (min(all_ys) + max(all_ys)) / 2

    # 4. 벽 quad 생성 (기초 높이에서 시작)
    wall_verts, wall_faces = _segments_to_quads(wall_segments, cx, cy, height - FOUNDATION_HEIGHT, base_z=FOUNDATION_HEIGHT)

    # 5. 문 패널 생성 (닫힌 문, 높이 2.1m)
    door_verts, door_faces = [], []
    if door_rectangles:
        dv, df = _door_rects_to_panels(door_rectangles, cx, cy, door_height=2.1)
        door_verts.extend(dv)
        door_faces.extend(df)
    if door_inserts:
        dv, df = _inserts_to_quads(door_inserts, cx, cy, 0.9, 2.1, base_z=FOUNDATION_HEIGHT)  # 폭 0.9m
        offset = len(door_verts)
        door_verts.extend(dv)
        door_faces.extend([[f[0]+offset, f[1]+offset, f[2]+offset] for f in df])

    # 6. 창문 quad 생성 (기초 + 창턱 0.8m, 높이 1.2m)
    window_sill_z = FOUNDATION_HEIGHT + 0.8  # 0.5 + 0.8 = 1.3m
    window_verts, window_faces = [], []
    window_rectangles = []  # 창문 사각형 저장 (벽체 생성용)
    if window_segments:
        wv, wf = _segments_to_quads(window_segments, cx, cy, 1.2, base_z=window_sill_z)
        window_verts.extend(wv)
        window_faces.extend(wf)
        # 창문 위치 추출 (벽체 생성용)
        for (x1, y1), (x2, y2) in window_segments:
            wcx = (x1 + x2) / 2
            wcy = (y1 + y2) / 2
            wwidth = ((x2-x1)**2 + (y2-y1)**2)**0.5
            import math
            wangle = math.degrees(math.atan2(y2-y1, x2-x1))
            window_rectangles.append((wcx, wcy, wwidth, 1.2, wangle))
    if window_inserts:
        wv, wf = _inserts_to_quads(window_inserts, cx, cy, 1.2, 1.2, base_z=window_sill_z)
        offset = len(window_verts)
        window_verts.extend(wv)
        window_faces.extend([[f[0]+offset, f[1]+offset, f[2]+offset] for f in wf])

    # 7. 개구부 주변 벽체 생성
    opening_wall_verts, opening_wall_faces = [], []

    # 문 위쪽 벽체 (2.1m ~ 건물높이)
    if door_rectangles:
        owv, owf = _create_opening_wall_sections(door_rectangles, cx, cy, 'door', height)
        opening_wall_verts.extend(owv)
        opening_wall_faces.extend(owf)
        steps.append({"label": "문 상부 벽체", "detail": f"{len(door_rectangles)}개"})

    # 창문 상/하 벽체 (0~0.8m, 2.0m~건물높이)
    if window_rectangles:
        offset = len(opening_wall_verts)
        owv, owf = _create_opening_wall_sections(window_rectangles, cx, cy, 'window', height)
        opening_wall_verts.extend(owv)
        opening_wall_faces.extend([[f[0]+offset, f[1]+offset, f[2]+offset] for f in owf])
        steps.append({"label": "창문 상/하 벽체", "detail": f"{len(window_rectangles)}개"})

    # 8. 지붕(상단 면) 생성
    roof_verts, roof_faces = _create_roof_from_segments(wall_segments, cx, cy, z=height, thickness=0.02)
    if roof_verts:
        steps.append({"label": "지붕 생성", "detail": f"{len(roof_faces)}개 삼각형"})

    # 8. 메쉬 리스트 구성
    meshes = []

    # 벽 + 개구부 주변 벽체 합치기
    all_wall_verts = wall_verts.copy()
    all_wall_faces = wall_faces.copy()
    if opening_wall_verts:
        offset = len(all_wall_verts)
        all_wall_verts.extend(opening_wall_verts)
        all_wall_faces.extend([[f[0]+offset, f[1]+offset, f[2]+offset] for f in opening_wall_faces])

    if all_wall_verts:
        meshes.append((
            np.array(all_wall_verts, dtype=np.float32),
            np.array(all_wall_faces, dtype=np.uint32),
            WALL_COLOR,
            "walls"
        ))

    if door_verts:
        meshes.append((
            np.array(door_verts, dtype=np.float32),
            np.array(door_faces, dtype=np.uint32),
            DOOR_COLOR,
            "doors"
        ))

    if window_verts:
        meshes.append((
            np.array(window_verts, dtype=np.float32),
            np.array(window_faces, dtype=np.uint32),
            WINDOW_COLOR,
            "windows"
        ))

    if roof_verts:
        meshes.append((
            np.array(roof_verts, dtype=np.float32),
            np.array(roof_faces, dtype=np.uint32),
            ROOF_COLOR,
            "roof"
        ))

    if not meshes:
        logger.error("생성된 메쉬 없음")
        return None

    # 8. GLB 내보내기
    try:
        mesh_stats = _export_multi_mesh_glb(meshes, output_path)
        steps.append({"label": "GLB 저장", "detail": f"{mesh_stats['file_size_kb']:.1f} KB"})

        logger.info(f"LOD3 Simple 완료: {mesh_stats}")

        return {
            "success": True,
            "lod": 3,
            "mesh_stats": mesh_stats,
            "steps": steps,
            "wall_segments": len(wall_segments),
            "door_count": len(door_rectangles) + len(door_inserts),
            "window_count": len(window_segments) + len(window_inserts),
        }
    except Exception as e:
        logger.error(f"GLB 생성 실패: {e}")
        return None
