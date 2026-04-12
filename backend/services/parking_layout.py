"""
주차구역 자동 배치 알고리즘

대지(site) 내에서 건물과 겹치지 않는 최대 직사각형 영역을 탐색하고,
그 안에 주차 슬롯 + 차로(aisle) 를 그리드로 배치한다.

주요 기능
---------
* ``generate_parking_layout`` — 메인 엔트리: 대지·건물 폴리곤 + 필요 대수 → 슬롯 배열
* ``find_parking_candidate_zone`` — 건물 footprint를 빼고 남은 대지에서 최대 직사각형 탐색
* ``pack_slots_in_zone`` — 직사각형 내부에 90° 직각 주차 + 6m 양방향 차로 패킹

좌표계
------
* 모든 좌표는 **로컬 미터(m)** 기준.
  프런트에서 Cesium 경위도로 변환할 때는 별도 유틸을 사용한다.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Optional

from shapely.geometry import Polygon, MultiPolygon, box
from shapely.affinity import rotate as shapely_rotate, translate as shapely_translate
from shapely.ops import unary_union
import numpy as np


# ── 상수 ────────────────────────────────────────────────────
SLOT_WIDTH_STANDARD = 2.5        # 일반 주차 슬롯 폭 (m)
SLOT_WIDTH_DISABLED = 3.3        # 장애인 슬롯 폭 (m)
SLOT_DEPTH = 5.0                 # 슬롯 깊이 (m)
AISLE_WIDTH = 6.0                # 양방향 차로 폭 (m)
ACCESS_ROAD_WIDTH = 4.0          # 진입로 폭 (m)
MIN_ZONE_WIDTH = SLOT_WIDTH_STANDARD * 2 + AISLE_WIDTH   # 최소 주차구역 폭 (≈11m)
MIN_ZONE_DEPTH = SLOT_DEPTH + AISLE_WIDTH                # 최소 주차구역 깊이 (≈11m)


# ── 데이터 모델 ─────────────────────────────────────────────

@dataclass
class ParkingSlot:
    """개별 주차 슬롯"""
    id: int
    slot_type: str                # "standard" | "disabled"
    cx: float                     # 중심 x (m)
    cy: float                     # 중심 y (m)
    width: float                  # 폭 (m)
    depth: float                  # 깊이 (m)
    heading: float = 0.0          # 회전각 (°, 0 = 북)
    polygon: list[list[float]] = field(default_factory=list)  # [[x,y], ...]


@dataclass
class ParkingAisle:
    """차로(통로)"""
    polygon: list[list[float]]
    direction: str = "horizontal"  # "horizontal" | "vertical"


@dataclass
class AccessPoint:
    """진입로 연결 지점"""
    x: float
    y: float
    road_x: float | None = None
    road_y: float | None = None
    width: float = ACCESS_ROAD_WIDTH


@dataclass
class ParkingLayout:
    """배치 결과 전체"""
    slots: list[ParkingSlot]
    aisles: list[ParkingAisle]
    access_point: AccessPoint | None
    zone_polygon: list[list[float]]    # 주차구역 외곽 [[x,y], ...]
    zone_center: list[float]           # [cx, cy]
    zone_rotation: float               # 구역 회전 (°)
    zone_width: float                  # 구역 폭 (m)
    zone_depth: float                  # 구역 깊이 (m)
    total_slots: int
    standard_slots: int
    disabled_slots: int
    total_area_m2: float
    parking_area_ratio: float          # 주차구역 면적 / 대지 면적
    warnings: list[str] = field(default_factory=list)


# ── 헬퍼 함수 ───────────────────────────────────────────────

def _rect_polygon(cx: float, cy: float, w: float, h: float, heading: float = 0.0) -> list[list[float]]:
    """중심·크기·회전각 → 4-point polygon (CCW)"""
    hw, hh = w / 2, h / 2
    corners = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]
    rad = math.radians(heading)
    cos_r, sin_r = math.cos(rad), math.sin(rad)
    rotated = []
    for x, y in corners:
        rx = x * cos_r - y * sin_r + cx
        ry = x * sin_r + y * cos_r + cy
        rotated.append([round(rx, 3), round(ry, 3)])
    return rotated


def _polygon_coords(poly: Polygon) -> list[list[float]]:
    """Shapely Polygon → [[x,y], ...] (마지막 중복 제거)"""
    coords = list(poly.exterior.coords)
    if coords and coords[0] == coords[-1]:
        coords = coords[:-1]
    return [[round(x, 3), round(y, 3)] for x, y in coords]


# ── 주차구역 후보 영역 탐색 ──────────────────────────────────

def find_parking_candidate_zone(
    site_poly: Polygon,
    building_poly: Polygon,
    access_point: tuple[float, float] | None = None,
    preferred_heading: float = 0.0,
) -> tuple[Polygon, float]:
    """
    대지에서 건물을 빼고, 주차구역으로 쓸 수 있는
    최대 축정렬(또는 회전) 직사각형을 탐색한다.

    Parameters
    ----------
    site_poly : Polygon
        대지 경계 (로컬 미터)
    building_poly : Polygon
        건물 footprint
    access_point : (x, y) | None
        진입로 위치 — 이쪽에 가까운 곳을 우선
    preferred_heading : float
        선호 회전각 (°)

    Returns
    -------
    (zone_rect, heading)
    """
    # 건물 뺀 잔여 영역
    available = site_poly.difference(building_poly.buffer(1.0))  # 1m 여유
    if available.is_empty:
        raise ValueError("건물을 배치하면 주차 가능 영역이 남지 않습니다")

    # MultiPolygon이면 가장 큰 조각 선택
    if isinstance(available, MultiPolygon):
        available = max(available.geoms, key=lambda g: g.area)

    best_rect: Polygon | None = None
    best_area = 0.0
    best_heading = 0.0

    # 여러 각도 시도
    headings = [preferred_heading]
    for delta in [0, 45, 90, 135]:
        h = (preferred_heading + delta) % 180
        if h not in headings:
            headings.append(h)

    for heading in headings:
        # 회전된 좌표에서 바운딩박스 → 다시 역회전하여 후보 사각형 구성
        rotated = shapely_rotate(available, -heading, origin='centroid')
        bx0, by0, bx1, by1 = rotated.bounds
        candidate_rotated = box(bx0, by0, bx1, by1).intersection(rotated)

        if candidate_rotated.is_empty:
            continue

        # 내접 직사각형 근사: bounds 안에서 세로·가로를 줄여가며 겹침 최소화
        rect = _find_largest_inscribed_rect(rotated, bx0, by0, bx1, by1)
        if rect is None:
            continue

        # 역회전하여 원래 좌표계로
        rect_original = shapely_rotate(rect, heading, origin=available.centroid)

        # 유효 면적 체크
        area = rect_original.area
        if area > best_area and rect_original.is_valid:
            best_rect = rect_original
            best_area = area
            best_heading = heading

    if best_rect is None:
        # fallback: available 자체의 bounding box
        bx0, by0, bx1, by1 = available.bounds
        best_rect = box(bx0, by0, bx1, by1).intersection(available)
        if isinstance(best_rect, MultiPolygon):
            best_rect = max(best_rect.geoms, key=lambda g: g.area)
        best_heading = 0.0

    return best_rect, best_heading


def _find_largest_inscribed_rect(
    poly: Polygon,
    bx0: float, by0: float, bx1: float, by1: float,
    steps: int = 10,
) -> Polygon | None:
    """
    축정렬 바운딩박스 내에서 poly에 완전히 포함되는
    가장 큰 직사각형을 그리드 탐색으로 찾는다.
    """
    best: Polygon | None = None
    best_area = 0.0

    w_total = bx1 - bx0
    h_total = by1 - by0

    for i in range(steps):
        for j in range(steps):
            x0 = bx0 + w_total * i / steps
            y0 = by0 + h_total * j / steps
            for wi in range(steps - i, 0, -1):
                for hi in range(steps - j, 0, -1):
                    x1 = bx0 + w_total * (i + wi) / steps
                    y1 = by0 + h_total * (j + hi) / steps
                    rect = box(x0, y0, x1, y1)
                    area = rect.area
                    if area <= best_area:
                        continue
                    if poly.contains(rect):
                        best = rect
                        best_area = area
    return best


# ── 슬롯 패킹 ───────────────────────────────────────────────

def pack_slots_in_zone(
    zone_width: float,
    zone_depth: float,
    required_total: int,
    required_disabled: int,
) -> tuple[list[ParkingSlot], list[ParkingAisle], list[str]]:
    """
    직사각형 구역(zone_width × zone_depth) 내에
    90° 직각 주차 슬롯 + 양방향 차로를 그리드 배치한다.

    레이아웃:
    ```
    [슬롯행] [차로 6m] [슬롯행]
    [슬롯행] [차로 6m] [슬롯행]
    ...
    ```

    Returns
    -------
    (slots, aisles, warnings)
    """
    warnings: list[str] = []
    slots: list[ParkingSlot] = []
    aisles: list[ParkingAisle] = []

    # 한 "모듈" = 슬롯깊이 + 차로 + 슬롯깊이  (=5+6+5 = 16m)
    module_depth = SLOT_DEPTH + AISLE_WIDTH + SLOT_DEPTH
    # 하단에 여유 (차량 진입) → 첫 차로는 하단에서 SLOT_DEPTH 이후
    num_modules = max(1, int(zone_depth / module_depth))
    remaining_depth = zone_depth - num_modules * module_depth

    # 남는 공간이 슬롯+차로 추가 가능하면 한쪽 행 추가
    extra_bottom_row = remaining_depth >= (SLOT_DEPTH + AISLE_WIDTH)
    if extra_bottom_row:
        # 맨 아래 한 행 더 추가
        pass

    # 한 행에 들어가는 슬롯 수
    slots_per_row_std = int(zone_width / SLOT_WIDTH_STANDARD)

    # 전체 행 수 = 모듈당 2행 (위아래)
    total_rows = num_modules * 2
    if extra_bottom_row:
        total_rows += 1
    max_capacity = total_rows * slots_per_row_std

    if max_capacity < required_total:
        warnings.append(
            f"주차구역 크기 부족: 최대 {max_capacity}대 배치 가능 "
            f"(필요 {required_total}대). 구역 확장을 검토하세요."
        )

    slot_id = 0
    placed_disabled = 0

    for module_idx in range(num_modules):
        base_y = module_idx * module_depth

        # 하단 슬롯 행 (y: base_y ~ base_y + SLOT_DEPTH)
        row_y_bottom = base_y + SLOT_DEPTH / 2
        _place_row(
            slots, slot_id, row_y_bottom, zone_width,
            required_total, required_disabled, placed_disabled,
        )
        row_count = min(slots_per_row_std, required_total - len(slots) + len(slots))
        # 업데이트
        for s in slots[slot_id:]:
            if s.slot_type == "disabled":
                placed_disabled += 1
        slot_id = len(slots)

        # 차로
        aisle_y = base_y + SLOT_DEPTH + AISLE_WIDTH / 2
        aisle_poly = _rect_polygon(zone_width / 2, aisle_y, zone_width, AISLE_WIDTH)
        aisles.append(ParkingAisle(polygon=aisle_poly, direction="horizontal"))

        # 상단 슬롯 행 (y: base_y + SLOT_DEPTH + AISLE_WIDTH ~ +SLOT_DEPTH)
        row_y_top = base_y + SLOT_DEPTH + AISLE_WIDTH + SLOT_DEPTH / 2
        _place_row(
            slots, slot_id, row_y_top, zone_width,
            required_total, required_disabled, placed_disabled,
        )
        for s in slots[slot_id:]:
            if s.slot_type == "disabled":
                placed_disabled += 1
        slot_id = len(slots)

        if len(slots) >= required_total:
            break

    # 남은 하단 행
    if extra_bottom_row and len(slots) < required_total:
        base_y = num_modules * module_depth
        aisle_poly = _rect_polygon(zone_width / 2, base_y + AISLE_WIDTH / 2, zone_width, AISLE_WIDTH)
        aisles.append(ParkingAisle(polygon=aisle_poly, direction="horizontal"))
        row_y = base_y + AISLE_WIDTH + SLOT_DEPTH / 2
        _place_row(
            slots, slot_id, row_y, zone_width,
            required_total, required_disabled, placed_disabled,
        )

    return slots, aisles, warnings


def _place_row(
    slots: list[ParkingSlot],
    start_id: int,
    row_cy: float,
    zone_width: float,
    required_total: int,
    required_disabled: int,
    placed_disabled: int,
) -> None:
    """한 행에 슬롯 배치"""
    x = 0.0
    sid = len(slots)

    while x + SLOT_WIDTH_STANDARD <= zone_width and len(slots) < required_total:
        # 장애인 슬롯 우선 배치 (행 시작 부분)
        if placed_disabled < required_disabled and sid - start_id < 1:
            w = SLOT_WIDTH_DISABLED
            stype = "disabled"
            if x + w > zone_width:
                w = SLOT_WIDTH_STANDARD
                stype = "standard"
            else:
                placed_disabled += 1
        else:
            w = SLOT_WIDTH_STANDARD
            stype = "standard"

        cx = x + w / 2
        poly = _rect_polygon(cx, row_cy, w, SLOT_DEPTH)

        slots.append(ParkingSlot(
            id=sid,
            slot_type=stype,
            cx=round(cx, 3),
            cy=round(row_cy, 3),
            width=w,
            depth=SLOT_DEPTH,
            heading=0.0,
            polygon=poly,
        ))
        x += w
        sid += 1


# ── 진입로 감지 ──────────────────────────────────────────────

def find_access_point_from_boundary(
    site_poly: Polygon,
    zone_center: tuple[float, float],
    road_lines: list[list[tuple[float, float]]] | None = None,
) -> AccessPoint:
    """
    대지 경계선에서 주차구역 중심에 가장 가까운 점을 진입로로 지정.
    road_lines가 있으면 도로와 가장 가까운 경계점을 우선.
    """
    boundary_coords = list(site_poly.exterior.coords)

    if road_lines:
        from shapely.geometry import LineString, Point
        road_union = unary_union([LineString(line) for line in road_lines])
        best_dist = float('inf')
        best_pt = boundary_coords[0]
        for coord in boundary_coords:
            pt = Point(coord)
            d = pt.distance(road_union)
            if d < best_dist:
                best_dist = d
                best_pt = coord
        nearest_road_pt = road_union.interpolate(road_union.project(Point(best_pt)))
        return AccessPoint(
            x=round(best_pt[0], 3),
            y=round(best_pt[1], 3),
            road_x=round(nearest_road_pt.x, 3),
            road_y=round(nearest_road_pt.y, 3),
        )

    # 도로 정보 없음 → 주차구역 중심에서 가장 가까운 경계점
    from shapely.geometry import Point
    zcx, zcy = zone_center
    best_dist = float('inf')
    best_pt = boundary_coords[0]
    for coord in boundary_coords:
        d = math.hypot(coord[0] - zcx, coord[1] - zcy)
        if d < best_dist:
            best_dist = d
            best_pt = coord

    return AccessPoint(x=round(best_pt[0], 3), y=round(best_pt[1], 3))


# ── 메인 엔트리 ─────────────────────────────────────────────

def generate_parking_layout(
    site_coords: list[list[float]],
    building_coords: list[list[float]],
    required_total: int,
    required_disabled: int = 1,
    road_lines: list[list[list[float]]] | None = None,
    preferred_heading: float = 0.0,
) -> ParkingLayout:
    """
    주차구역 자동 배치 메인 함수.

    Parameters
    ----------
    site_coords : [[x,y], ...]
        대지 경계 (로컬 미터)
    building_coords : [[x,y], ...]
        건물 footprint (로컬 미터)
    required_total : int
        필요 총 대수
    required_disabled : int
        장애인 전용 대수
    road_lines : [[[x,y], ...], ...] | None
        도로 중심선 (DXF에서 추출)
    preferred_heading : float
        선호 주차구역 방향 (°)

    Returns
    -------
    ParkingLayout
    """
    site_poly = Polygon(site_coords)
    building_poly = Polygon(building_coords)

    if not site_poly.is_valid:
        site_poly = site_poly.buffer(0)
    if not building_poly.is_valid:
        building_poly = building_poly.buffer(0)

    site_area = site_poly.area

    # 1. 주차구역 후보 탐색
    zone_poly, heading = find_parking_candidate_zone(
        site_poly, building_poly,
        preferred_heading=preferred_heading,
    )

    # 구역의 로컬 바운딩박스 (축정렬)
    rotated_zone = shapely_rotate(zone_poly, -heading, origin=zone_poly.centroid)
    bx0, by0, bx1, by1 = rotated_zone.bounds
    zone_w = bx1 - bx0
    zone_d = by1 - by0

    warnings: list[str] = []
    if zone_w < MIN_ZONE_WIDTH or zone_d < MIN_ZONE_DEPTH:
        warnings.append(
            f"주차 가능 영역({zone_w:.1f}×{zone_d:.1f}m)이 "
            f"최소 기준({MIN_ZONE_WIDTH:.0f}×{MIN_ZONE_DEPTH:.0f}m)보다 작습니다."
        )

    # 2. 슬롯 패킹 (로컬 축정렬 좌표계)
    slots_local, aisles_local, pack_warnings = pack_slots_in_zone(
        zone_w, zone_d, required_total, required_disabled,
    )
    warnings.extend(pack_warnings)

    # 3. 로컬 → 월드 변환 (회전 + 이동)
    centroid = zone_poly.centroid
    offset_x = bx0  # rotated zone 원점
    offset_y = by0

    def to_world(lx: float, ly: float) -> tuple[float, float]:
        """로컬(축정렬) → 월드(원래 대지 좌표계)"""
        # 축정렬 원점 보정
        wx = lx + offset_x
        wy = ly + offset_y
        # 회전 적용 (centroid 기준)
        from shapely.geometry import Point
        pt = shapely_rotate(Point(wx, wy), heading, origin=rotated_zone.centroid)
        return round(pt.x, 3), round(pt.y, 3)

    # 슬롯 월드 좌표 변환
    for slot in slots_local:
        world_cx, world_cy = to_world(slot.cx, slot.cy)
        slot.cx = world_cx
        slot.cy = world_cy
        slot.heading = heading
        slot.polygon = [list(to_world(p[0], p[1])) for p in slot.polygon]

    # 차로 월드 좌표 변환
    for aisle in aisles_local:
        aisle.polygon = [list(to_world(p[0], p[1])) for p in aisle.polygon]

    # 4. 진입로
    zone_center_world = (centroid.x, centroid.y)
    road_tuples = None
    if road_lines:
        road_tuples = [[(p[0], p[1]) for p in line] for line in road_lines]
    access = find_access_point_from_boundary(site_poly, zone_center_world, road_tuples)

    # 5. 통계
    n_std = sum(1 for s in slots_local if s.slot_type == "standard")
    n_dis = sum(1 for s in slots_local if s.slot_type == "disabled")
    total = n_std + n_dis
    parking_area = zone_w * zone_d
    ratio = (parking_area / site_area) * 100 if site_area > 0 else 0.0

    return ParkingLayout(
        slots=slots_local,
        aisles=aisles_local,
        access_point=access,
        zone_polygon=_polygon_coords(zone_poly),
        zone_center=[round(centroid.x, 3), round(centroid.y, 3)],
        zone_rotation=heading,
        zone_width=round(zone_w, 2),
        zone_depth=round(zone_d, 2),
        total_slots=total,
        standard_slots=n_std,
        disabled_slots=n_dis,
        total_area_m2=round(parking_area, 2),
        parking_area_ratio=round(ratio, 1),
        warnings=warnings,
    )
