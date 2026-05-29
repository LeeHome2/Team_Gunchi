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


def _extract_inserts_from_layer(msp, layers: List[str], dxf_scale: float = 1.0) -> List[Tuple[float, float, float]]:
    """레이어에서 INSERT(블록 참조) 위치 + 회전 각도 추출.

    Returns:
        [(x, y, rotation_deg), ...]
    """
    positions = []
    for entity in msp:
        if entity.dxf.layer not in layers:
            continue
        if entity.dxftype() == 'INSERT':
            pos = entity.dxf.insert
            rotation = getattr(entity.dxf, 'rotation', 0.0)  # 회전 각도 (도)
            positions.append((pos[0] * dxf_scale, pos[1] * dxf_scale, rotation))
    return positions


def _find_nearest_wall_direction(
    x: float, y: float,
    wall_segments: List[Tuple[Tuple[float, float], Tuple[float, float]]],
    max_distance: float = 5.0
) -> float:
    """주어진 위치에서 가장 가까운 벽 선분의 방향(각도)을 찾음.

    Args:
        x, y: 개구부 위치
        wall_segments: 벽 선분 리스트 [((x1, y1), (x2, y2)), ...]
        max_distance: 최대 탐색 거리 (m)

    Returns:
        벽 선분 방향 각도 (도), 찾지 못하면 0
    """
    import math

    best_dist = float('inf')
    best_angle = 0.0

    for (x1, y1), (x2, y2) in wall_segments:
        # 선분과 점 사이의 최단 거리 계산
        dx = x2 - x1
        dy = y2 - y1
        seg_len_sq = dx * dx + dy * dy

        if seg_len_sq < 0.0001:  # 점에 가까운 선분
            dist = math.sqrt((x - x1)**2 + (y - y1)**2)
        else:
            # 선분 위 투영점 계산
            t = max(0, min(1, ((x - x1) * dx + (y - y1) * dy) / seg_len_sq))
            proj_x = x1 + t * dx
            proj_y = y1 + t * dy
            dist = math.sqrt((x - proj_x)**2 + (y - proj_y)**2)

        if dist < best_dist and dist < max_distance:
            best_dist = dist
            best_angle = math.degrees(math.atan2(dy, dx))

    return best_angle


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


def _detect_dxf_scale(doc) -> Tuple[float, Dict[str, Any]]:
    """DXF 단위 자동 감지 + 진단 정보.

    [패치 3] 반환 형태 변경: (scale, diagnosis_dict)

    1차: DXF 헤더의 $INSUNITS 메타데이터 사용
    2차: 적용 후 결과 크기가 비합리적이면 휴리스틱으로 보정
    3차: 좌표 범위(extent) 기반 휴리스틱 추정

    $INSUNITS 코드:
    0=Unspecified, 1=Inches, 2=Feet, 4=mm, 5=cm, 6=m

    Returns:
        (scale, diagnosis_dict)
        diagnosis: {raw_extent, insunits, insunits_unit, decision_path, final_scale, final_size_m}
    """
    msp = doc.modelspace()

    # 진단 정보 초기화
    diagnosis: Dict[str, Any] = {
        "raw_extent": None,
        "insunits": None,
        "insunits_unit": None,
        "decision_path": "",
        "final_scale": None,
        "final_size_m": None,
    }

    # 먼저 extent 계산 (헤더 검증에 필요)
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
        logger.warning("No geometry found for extent detection")
        diagnosis["decision_path"] = "no_geometry_fallback_1.0"
        diagnosis["final_scale"] = 1.0
        return 1.0, diagnosis

    raw_extent = max(max(xs) - min(xs), max(ys) - min(ys))
    diagnosis["raw_extent"] = raw_extent
    logger.info(f"DXF raw extent: {raw_extent:.4f}")

    # === 1차: DXF 헤더 메타데이터 확인 ===
    UNIT_SCALES = {
        1: (0.0254, "inches"),    # 1 inch = 0.0254 m
        2: (0.3048, "feet"),      # 1 foot = 0.3048 m
        4: (0.001, "mm"),         # 1 mm = 0.001 m
        5: (0.01, "cm"),          # 1 cm = 0.01 m
        6: (1.0, "m"),            # 1 m = 1 m
        7: (1000.0, "km"),        # 1 km = 1000 m
        8: (0.0000254, "microinches"),
        9: (0.0000254, "mils"),   # 1 mil = 0.001 inch
        10: (0.9144, "yards"),    # 1 yard = 0.9144 m
        14: (0.1, "dm"),          # 1 dm = 0.1 m
    }

    # 합리적인 건물 크기 범위 (3m ~ 300m)
    MIN_BUILDING = 3
    MAX_BUILDING = 300

    try:
        insunits = doc.header.get('$INSUNITS', 0)
        diagnosis["insunits"] = insunits

        if insunits in UNIT_SCALES:
            scale, unit_name = UNIT_SCALES[insunits]
            diagnosis["insunits_unit"] = unit_name
            resulting_size = raw_extent * scale

            # 결과 크기가 합리적인지 검증
            if MIN_BUILDING <= resulting_size <= MAX_BUILDING:
                logger.info(f"DXF header $INSUNITS={insunits} ({unit_name}) -> scale={scale}, size={resulting_size:.1f}m (valid)")
                diagnosis["decision_path"] = f"header_insunits_{insunits}_{unit_name}"
                diagnosis["final_scale"] = scale
                diagnosis["final_size_m"] = resulting_size
                return scale, diagnosis
            else:
                # INSUNITS 적용 결과가 비합리적이어도 자동 1:N 보정 X — 사용자가 force_scale 로 명시
                # [패치 1] 1:100/1:50/1:200 자동 적용 블록 제거됨
                logger.warning(
                    f"$INSUNITS={insunits} ({unit_name}) -> size={resulting_size:.4f}m unreasonable. "
                    f"Returning INSUNITS scale ({scale}) anyway. "
                    f"User can override with force_scale parameter."
                )
                diagnosis["decision_path"] = f"header_insunits_{insunits}_{unit_name}_unreasonable_returned_anyway"
                diagnosis["final_scale"] = scale
                diagnosis["final_size_m"] = resulting_size
                return scale, diagnosis
        elif insunits != 0:
            logger.warning(f"Unknown $INSUNITS value: {insunits}, falling back to extent detection")
    except Exception as e:
        logger.warning(f"Failed to read $INSUNITS: {e}")

    # === 2차: Extent 기반 휴리스틱 ===
    extent = raw_extent
    logger.info(f"DXF extent: {extent:.4f} (using heuristics)")

    # 단위별 변환값 계산
    as_mm = extent / 1000      # mm -> m (extent가 mm 단위라고 가정)
    as_cm = extent / 100       # cm -> m
    as_inch = extent * 0.0254  # inch -> m
    as_feet = extent * 0.3048  # feet -> m

    def is_valid_building(size_m):
        return MIN_BUILDING <= size_m <= MAX_BUILDING

    def make_result(scale: float, decision_path: str) -> Tuple[float, Dict[str, Any]]:
        diagnosis["decision_path"] = decision_path
        diagnosis["final_scale"] = scale
        diagnosis["final_size_m"] = raw_extent * scale
        return scale, diagnosis

    # 10000 이상: 확실히 mm 단위 (10m+ 건물)
    if extent > 10000:
        logger.info(f"Heuristic: mm units (extent={extent:.0f}mm -> {as_mm:.1f}m)")
        return make_result(0.001, "heuristic_extent_gt_10000_mm")

    # 500~10000: cm, inch, mm 중 선택
    if extent > 500:
        candidates = []
        if is_valid_building(as_cm):
            candidates.append(('cm', 0.01, as_cm))
        if is_valid_building(as_inch):
            candidates.append(('inch', 0.0254, as_inch))
        if is_valid_building(as_mm):
            candidates.append(('mm', 0.001, as_mm))

        if candidates:
            def score(c):
                size = c[2]
                if 10 <= size <= 50:
                    return 0
                elif 5 <= size <= 100:
                    return 1
                return 2
            candidates.sort(key=score)
            unit, scale, size = candidates[0]
            logger.info(f"Heuristic: {unit} units (extent={extent:.0f} -> {size:.1f}m)")
            return make_result(scale, f"heuristic_500_10000_{unit}")
        logger.info(f"Heuristic: fallback cm (extent={extent:.0f}cm -> {as_cm:.1f}m)")
        return make_result(0.01, "heuristic_500_10000_fallback_cm")

    # 200~500: inch, feet, m 중 선택
    if extent > 200:
        candidates = []
        if is_valid_building(as_inch):
            candidates.append(('inch', 0.0254, as_inch))
        if is_valid_building(as_feet):
            candidates.append(('feet', 0.3048, as_feet))
        if is_valid_building(extent):
            candidates.append(('m', 1.0, extent))

        if candidates:
            def score(c):
                size = c[2]
                if 10 <= size <= 50:
                    return 0
                elif 5 <= size <= 100:
                    return 1
                return 2
            candidates.sort(key=score)
            unit, scale, size = candidates[0]
            logger.info(f"Heuristic: {unit} units (extent={extent:.1f} -> {size:.1f}m)")
            return make_result(scale, f"heuristic_200_500_{unit}")
        logger.info(f"Heuristic: meters (extent={extent:.1f}m, large building)")
        return make_result(1.0, "heuristic_200_500_fallback_m")

    # 5~200: m, feet, inch 중 선택
    if extent >= 5:
        candidates = []
        if is_valid_building(extent):
            candidates.append(('m', 1.0, extent))
        if is_valid_building(as_feet):
            candidates.append(('feet', 0.3048, as_feet))
        if is_valid_building(as_inch):
            candidates.append(('inch', 0.0254, as_inch))

        if candidates:
            def score(c):
                size = c[2]
                if 10 <= size <= 50:
                    return 0
                elif 5 <= size <= 100:
                    return 1
                return 2
            candidates.sort(key=score)
            unit, scale, size = candidates[0]
            logger.info(f"Heuristic: {unit} units (extent={extent:.1f} -> {size:.1f}m)")
            return make_result(scale, f"heuristic_5_200_{unit}")
        logger.info(f"Heuristic: meters (extent={extent:.1f}m)")
        return make_result(1.0, "heuristic_5_200_fallback_m")

    # 1~5: feet 또는 m
    if extent >= 1:
        if is_valid_building(as_feet):
            logger.info(f"Heuristic: feet (extent={extent:.2f}ft -> {as_feet:.2f}m)")
            return make_result(0.3048, "heuristic_1_5_feet")
        return make_result(1.0, "heuristic_1_5_fallback_m")

    # extent < 1: 단위 추정 불가. 1.0 fallback (사용자 force_scale 권장)
    # [패치 1] 1:100/1:1000 자동 적용 블록 제거됨
    logger.warning(
        f"Heuristic: extent={extent:.4f} is too small for reliable detection. "
        f"Falling back to scale=1.0 (m). Use force_scale to override."
    )
    return make_result(1.0, "heuristic_extent_too_small_fallback_1.0")


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
    positions: List[Tuple[float, float, float]],
    cx: float, cy: float,
    width: float,
    height: float,
    base_z: float = 0.0,
    wall_segments: Optional[List[Tuple[Tuple[float, float], Tuple[float, float]]]] = None,
    is_door: bool = False
) -> Tuple[List[List[float]], List[List[int]]]:
    """INSERT 위치를 벽 방향에 맞춘 quad로 변환.

    Args:
        positions: [(x, y, rotation_deg), ...] — INSERT 위치 + 원래 회전 각도
        cx, cy: 모델 중심점
        width: 개구부 폭
        height: 개구부 높이
        base_z: 바닥 높이
        wall_segments: 벽 선분 리스트 (방향 결정용, 스케일 적용 전 원본)
        is_door: True이면 닫힌 문 형태 (INSERT에서 벽 방향으로 확장)

    Returns:
        (vertices, faces)
    """
    import math

    vertices = []
    faces = []

    for item in positions:
        x, y = item[0], item[1]
        # 원래 회전 각도 (있으면)
        orig_rotation = item[2] if len(item) > 2 else 0.0

        # 가장 가까운 벽 선분 방향 찾기 (wall_segments는 스케일 적용된 좌표)
        if wall_segments:
            wall_angle = _find_nearest_wall_direction(x, y, wall_segments, max_distance=10.0)
        else:
            wall_angle = orig_rotation  # 폴백: INSERT 원래 회전 사용

        # 중심점 기준 정규화
        x, y = x - cx, y - cy

        # 벽 방향 각도 (라디안)
        angle_rad = math.radians(wall_angle)
        cos_a = math.cos(angle_rad)
        sin_a = math.sin(angle_rad)

        if is_door:
            # 닫힌 문: INSERT(경첩 위치)에서 벽 방향으로 문 폭만큼 확장
            # INSERT 위치 = 경첩 위치 (한쪽 끝)
            x1 = x
            y1 = y
            # 벽 방향으로 문 폭만큼 확장
            x2 = x + width * cos_a
            y2 = y + width * sin_a
            logger.debug(f"[Door] hinge=({x:.2f},{y:.2f}), wall_angle={wall_angle:.1f}, end=({x2:.2f},{y2:.2f})")
        else:
            # 창문: INSERT 위치를 중심으로 양쪽 확장
            half_w = width / 2
            x1 = x - half_w * cos_a
            y1 = y - half_w * sin_a
            x2 = x + half_w * cos_a
            y2 = y + half_w * sin_a

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


def _create_wall_cap(
    segments: List[Tuple[Tuple[float, float], Tuple[float, float]]],
    cx: float, cy: float,
    z: float,
    thickness: float = 0.1  # 벽 두께 (10cm)
) -> Tuple[List[List[float]], List[List[int]]]:
    """벽 선분을 따라가는 얇은 상단 캡 생성.

    벽 선분들을 buffer로 확장 후 병합하여 자연스러운 벽 상단 표현.
    """
    from shapely.geometry import LineString
    from shapely.ops import unary_union

    if not segments:
        return [], []

    # 선분들을 buffer로 확장
    buffered = []
    for (x1, y1), (x2, y2) in segments:
        line = LineString([(x1 - cx, y1 - cy), (x2 - cx, y2 - cy)])
        buf = line.buffer(thickness / 2, cap_style=2)  # flat ends
        if not buf.is_empty:
            buffered.append(buf)

    if not buffered:
        return [], []

    merged = unary_union(buffered)

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
            from trimesh.creation import extrude_polygon
            mesh = extrude_polygon(poly, height=0.01)
            max_z_val = mesh.vertices[:, 2].max()
            top_mask = mesh.vertices[:, 2] >= max_z_val - 0.001
            top_indices = np.where(top_mask)[0]
            if len(top_indices) < 3:
                continue

            top_faces = []
            for face in mesh.faces:
                if all(top_mask[v] for v in face):
                    top_faces.append(face)

            if not top_faces:
                continue

            base_idx = len(vertices)
            idx_map = {}
            for i, old_idx in enumerate(top_indices):
                v = mesh.vertices[old_idx]
                vertices.append([float(v[0]), float(v[1]), z])
                idx_map[old_idx] = base_idx + i

            for face in top_faces:
                new_face = [idx_map[v] for v in face if v in idx_map]
                if len(new_face) == 3:
                    faces.append(new_face)

        except Exception as e:
            logger.debug(f"벽 캡 삼각화 실패: {e}")
            continue

    logger.info(f"벽 캡 생성: {len(vertices)}개 정점, {len(faces)}개 면")
    return vertices, faces


def _create_roof_slab(
    segments: List[Tuple[Tuple[float, float], Tuple[float, float]]],
    cx: float, cy: float,
    z: float,
    thickness: float = 0.15  # 슬래브 두께 (15cm)
) -> Tuple[List[List[float]], List[List[int]]]:
    """건물 전체를 덮는 하나의 천장 슬래브 생성.

    모든 벽 선분의 끝점들을 모아 Convex Hull로 건물 전체 외곽을 찾고,
    상단 면만 생성 (매끈한 단일 면).
    """
    from shapely.geometry import MultiPoint
    import math

    if not segments:
        return [], []

    # 모든 벽 끝점 수집 (중심 기준 좌표)
    all_points = []
    for (x1, y1), (x2, y2) in segments:
        all_points.append((x1 - cx, y1 - cy))
        all_points.append((x2 - cx, y2 - cy))

    if len(all_points) < 3:
        return [], []

    # 중복 제거
    unique_points = list(set(all_points))
    if len(unique_points) < 3:
        return [], []

    # Convex Hull로 건물 전체 외곽 찾기
    try:
        outline = MultiPoint(unique_points).convex_hull
        if outline.geom_type != 'Polygon' or outline.is_empty:
            logger.error("Convex hull 생성 실패")
            return [], []
        logger.info(f"슬래브 외곽선 (Convex Hull): area={outline.area:.1f}m2")
    except Exception as e:
        logger.error(f"Convex hull 실패: {e}")
        return [], []

    # 외곽선 좌표 추출 (반시계 방향)
    coords = list(outline.exterior.coords)[:-1]  # 마지막 중복 점 제거
    if len(coords) < 3:
        return [], []

    vertices = []
    faces = []

    # 상단 면 (z + thickness) - Fan triangulation
    top_z = z + thickness
    n = len(coords)

    # 정점 추가 (상단 면)
    for x, y in coords:
        vertices.append([float(x), float(y), float(top_z)])

    # 삼각형 면 생성 (fan triangulation - 중심에서 방사형)
    # 반시계 방향으로 면 생성 (법선이 위를 향하도록)
    for i in range(1, n - 1):
        faces.append([0, i, i + 1])

    # 하단 면 (z) - 옵션: 두께가 필요하면 추가
    if thickness > 0.01:
        base_idx = len(vertices)
        for x, y in coords:
            vertices.append([float(x), float(y), float(z)])

        # 하단 면 (시계 방향 - 법선이 아래를 향하도록)
        for i in range(1, n - 1):
            faces.append([base_idx, base_idx + i + 1, base_idx + i])

        # 측면 (상단과 하단 연결)
        for i in range(n):
            next_i = (i + 1) % n
            # 상단 정점: i, next_i
            # 하단 정점: base_idx + i, base_idx + next_i
            top1, top2 = i, next_i
            bot1, bot2 = base_idx + i, base_idx + next_i
            # 두 개의 삼각형으로 사각형 면 생성
            faces.append([top1, bot1, bot2])
            faces.append([top1, bot2, top2])

    logger.info(f"천장 슬래브 생성: {len(vertices)}개 정점, {len(faces)}개 면, 면적={outline.area:.1f}m2")

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

        # Z-up → Y-up 변환 (DXF 좌표계 → glTF 좌표계)
        # DXF: X=right, Y=forward, Z=up → glTF: X=right, Y=up, Z=back
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
    bounds: Optional[Dict[str, float]] = None,  # {"min_x", "max_x", "min_y", "max_y"}
    include_roof: bool = True,  # 천장 슬래브 포함 여부
    force_scale: Optional[float] = None,  # [패치 2] 사용자 스케일 오버라이드
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
        include_roof: 천장 슬래브 포함 여부 (기본: True)

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

    # [패치 2+3] 스케일 결정 — force_scale 우선, diagnosis 포함
    if force_scale is not None:
        dxf_scale = force_scale
        scale_diagnosis = {
            "raw_extent": None,
            "insunits": None,
            "insunits_unit": None,
            "decision_path": "user_force_scale",
            "final_scale": force_scale,
            "final_size_m": None,
        }
        logger.info(f"DXF scale FORCED by user: {force_scale}")
    else:
        # 스케일 감지 (헤더 $INSUNITS 우선, 없으면 extent 휴리스틱)
        dxf_scale, scale_diagnosis = _detect_dxf_scale(doc)
        logger.info(f"DXF scale (auto-detected): {dxf_scale}, path={scale_diagnosis.get('decision_path')}")

    # bounds에도 스케일 적용 (벽 선분과 동일한 좌표계로 변환)
    scaled_bounds = None
    if bounds and dxf_scale != 1.0:
        scaled_bounds = {
            "min_x": bounds["min_x"] * dxf_scale,
            "max_x": bounds["max_x"] * dxf_scale,
            "min_y": bounds["min_y"] * dxf_scale,
            "max_y": bounds["max_y"] * dxf_scale,
        }
        logger.info(f"Bounds 스케일 적용: {dxf_scale} → {scaled_bounds}")
    elif bounds:
        scaled_bounds = bounds

    # 범위 필터링 함수
    def in_bounds(x: float, y: float) -> bool:
        if not scaled_bounds:
            return True
        return (scaled_bounds.get("min_x", float("-inf")) <= x <= scaled_bounds.get("max_x", float("inf")) and
                scaled_bounds.get("min_y", float("-inf")) <= y <= scaled_bounds.get("max_y", float("inf")))

    def filter_segments(segments):
        if not bounds:
            return segments
        # 엄격한 필터: 양 끝점 모두 bbox 내에 있어야 포함 (인접 평면도 제외)
        return [((x1, y1), (x2, y2)) for (x1, y1), (x2, y2) in segments
                if in_bounds(x1, y1) and in_bounds(x2, y2)]

    def filter_positions(positions):
        """INSERT 위치 필터링 (회전 각도 유지)."""
        if not bounds:
            return positions
        # (x, y, rotation) 형식 유지
        return [p for p in positions if in_bounds(p[0], p[1])]

    def filter_rectangles(rects):
        if not bounds:
            return rects
        return [(cx, cy, w, h, a) for cx, cy, w, h, a in rects if in_bounds(cx, cy)]

    # 1. 벽 선분 추출
    wall_segments_raw = _extract_lines_from_layer(msp, wall_layers, dxf_scale)
    logger.info(f"벽 선분 추출 (필터 전): {len(wall_segments_raw)}개")

    # 필터 전 범위 계산
    if wall_segments_raw:
        raw_xs = [x for seg in wall_segments_raw for x in [seg[0][0], seg[1][0]]]
        raw_ys = [y for seg in wall_segments_raw for y in [seg[0][1], seg[1][1]]]
        logger.info(f"필터 전 범위: X=[{min(raw_xs):.1f}, {max(raw_xs):.1f}], Y=[{min(raw_ys):.1f}, {max(raw_ys):.1f}]")

    wall_segments = filter_segments(wall_segments_raw)
    logger.info(f"벽 선분 추출 (필터 후): {len(wall_segments)}개, scaled_bounds={scaled_bounds}")

    # 필터 후 범위 계산
    if wall_segments:
        filt_xs = [x for seg in wall_segments for x in [seg[0][0], seg[1][0]]]
        filt_ys = [y for seg in wall_segments for y in [seg[0][1], seg[1][1]]]
        logger.info(f"필터 후 범위: X=[{min(filt_xs):.1f}, {max(filt_xs):.1f}], Y=[{min(filt_ys):.1f}, {max(filt_ys):.1f}]")
    if not wall_segments:
        logger.error(f"벽 레이어에서 선분을 찾을 수 없음: {wall_layers}")
        return None
    steps.append({"label": "벽 선분 추출", "detail": f"{len(wall_segments)}개 (필터 전: {len(wall_segments_raw)}개)"})

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
        # wall_segments를 전달하여 벽 방향에 맞춤, is_door=True로 닫힌 문 형태
        dv, df = _inserts_to_quads(door_inserts, cx, cy, 0.9, 2.1, base_z=FOUNDATION_HEIGHT, wall_segments=wall_segments, is_door=True)
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
        # wall_segments를 전달하여 벽 방향에 맞춤, is_door=False로 중심 기준 확장
        wv, wf = _inserts_to_quads(window_inserts, cx, cy, 1.2, 1.2, base_z=window_sill_z, wall_segments=wall_segments, is_door=False)
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

    # 8. 천장 슬래브 또는 벽 상단 캡 생성
    roof_verts, roof_faces = [], []
    wall_cap_verts, wall_cap_faces = [], []

    if include_roof:
        # 슬래브 ON: 건물 전체를 덮는 지붕 슬래브 생성
        roof_verts, roof_faces = _create_roof_slab(wall_segments, cx, cy, z=height, thickness=0.15)
        if roof_verts:
            steps.append({"label": "천장 슬래브", "detail": f"{len(roof_faces)}개 삼각형"})
    else:
        # 슬래브 OFF: 벽 상단 캡만 생성 (roof_slab과 동일한 Convex Hull 사용)
        wall_cap_verts, wall_cap_faces = _create_wall_cap(wall_segments, cx, cy, z=height, thickness=0.02)
        if wall_cap_verts:
            steps.append({"label": "벽 상단 캡", "detail": f"{len(wall_cap_faces)}개 삼각형"})

    # 10. 메쉬 리스트 구성
    meshes = []

    # 벽 + 개구부 주변 벽체 + 벽 상단 캡 합치기
    all_wall_verts = wall_verts.copy()
    all_wall_faces = wall_faces.copy()
    if opening_wall_verts:
        offset = len(all_wall_verts)
        all_wall_verts.extend(opening_wall_verts)
        all_wall_faces.extend([[f[0]+offset, f[1]+offset, f[2]+offset] for f in opening_wall_faces])
    if wall_cap_verts:
        offset = len(all_wall_verts)
        all_wall_verts.extend(wall_cap_verts)
        all_wall_faces.extend([[f[0]+offset, f[1]+offset, f[2]+offset] for f in wall_cap_faces])

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

    # 천장 슬래브 (include_roof=True일 때만 roof_verts가 있음)
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

        # 개구부 위치 목록 생성 (Cesium 마커용)
        openings = []

        # 건물 외곽선 계산 (주 출입문 판단용)
        # 벽 세그먼트 끝점들로 convex hull 생성
        from shapely.geometry import MultiPoint, Point
        wall_points = []
        for seg in wall_segments:
            # seg = ((x1, y1), (x2, y2)) 형식
            (x1, y1), (x2, y2) = seg
            wall_points.append((x1, y1))
            wall_points.append((x2, y2))

        exterior_boundary = None
        if len(wall_points) >= 3:
            try:
                from shapely.geometry import Polygon as ShapelyPolygon
                mp = MultiPoint(wall_points)
                hull = mp.convex_hull
                # convex_hull이 Polygon인 경우에만 exterior 사용
                if isinstance(hull, ShapelyPolygon) and hull.exterior:
                    exterior_boundary = hull.exterior
            except Exception as e:
                logger.warning(f"외곽선 계산 실패: {e}")
                pass

        # 모든 문(door_rectangles + door_inserts)의 외곽선 거리 계산
        all_door_distances = []

        # door_rectangles (ARC 기반)
        for rect in door_rectangles:
            door_cx, door_cy = rect[0], rect[1]
            dist_to_exterior = float('inf')
            if exterior_boundary:
                try:
                    pt = Point(door_cx, door_cy)
                    dist_to_exterior = exterior_boundary.distance(pt)
                except:
                    pass
            all_door_distances.append(dist_to_exterior)

        # door_inserts (INSERT 블록 기반)
        for ins in door_inserts:
            door_x, door_y = ins[0], ins[1]
            dist_to_exterior = float('inf')
            if exterior_boundary:
                try:
                    pt = Point(door_x, door_y)
                    dist_to_exterior = exterior_boundary.distance(pt)
                except:
                    pass
            all_door_distances.append(dist_to_exterior)

        # 가장 외곽에 가까운 문 찾기 (거리가 가장 작은 문)
        main_entrance_threshold = float('inf')
        if all_door_distances:
            min_dist = min(all_door_distances)
            main_entrance_threshold = min_dist + 0.5  # 0.5m 오차 허용

        for rect in door_rectangles:
            door_cx, door_cy = rect[0], rect[1]
            dist_to_exterior = float('inf')
            if exterior_boundary:
                try:
                    pt = Point(door_cx, door_cy)
                    dist_to_exterior = exterior_boundary.distance(pt)
                except:
                    pass

            is_main_entrance = dist_to_exterior <= main_entrance_threshold

            openings.append({
                "x": float(rect[0] - cx),  # 모델 중심 기준
                "y": float(rect[1] - cy),
                "width": float(rect[2]),
                "height": 2.1,  # 문 높이 고정
                "rotation": float(rect[4]) if len(rect) > 4 else 0,
                "type": "door",
                "isMainEntrance": is_main_entrance,
                "distToExterior": round(dist_to_exterior, 2) if dist_to_exterior != float('inf') else None
            })

        # 문 INSERT 위치 (door_inserts: (x, y, rotation_deg))
        for ins in door_inserts:
            door_x, door_y = ins[0], ins[1]
            door_rot = ins[2] if len(ins) > 2 else 0
            dist_to_exterior = float('inf')
            if exterior_boundary:
                try:
                    pt = Point(door_x, door_y)
                    dist_to_exterior = exterior_boundary.distance(pt)
                except:
                    pass
            is_main_entrance = dist_to_exterior <= main_entrance_threshold

            openings.append({
                "x": float(door_x - cx),
                "y": float(door_y - cy),
                "width": 0.9,  # INSERT 문 기본 폭
                "height": 2.1,
                "rotation": float(door_rot),
                "type": "door",
                "isMainEntrance": is_main_entrance,
                "distToExterior": round(dist_to_exterior, 2) if dist_to_exterior != float('inf') else None
            })

        # 창문 위치 (window_rectangles: (cx, cy, width, height, angle))
        for rect in window_rectangles:
            openings.append({
                "x": float(rect[0] - cx),
                "y": float(rect[1] - cy),
                "width": float(rect[2]),
                "height": float(rect[3]) if len(rect) > 3 else 1.2,
                "rotation": float(rect[4]) if len(rect) > 4 else 0,
                "type": "window",
                "isMainEntrance": False
            })

        return {
            "success": True,
            "lod": 3,
            "mesh_stats": mesh_stats,
            "steps": steps,
            "wall_segments": len(wall_segments),
            "door_count": len(door_rectangles) + len(door_inserts),
            "window_count": len(window_segments) + len(window_inserts),
            "openings": openings,
            "dxf_scale": dxf_scale,  # 디버깅용: 감지된 스케일
            "scale_diagnosis": scale_diagnosis,  # [패치 3] 스케일 진단 정보
        }
    except Exception as e:
        logger.error(f"GLB 생성 실패: {e}")
        return None
