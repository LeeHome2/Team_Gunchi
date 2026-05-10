"""
도면에서 메인 출입구 + 주 창문 면 추출 (휴리스틱).

학습 모델 안 씀. 규칙:
1. 외벽 = wall centerline 의 outer perimeter
2. 메인 출입구 = 외벽에 붙은 문 중 가장 큰 것 (폭 최대)
3. 주 창문 면 = 외벽 segment 마다 붙은 창문 폭 합 → 합 최대인 segment
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

import numpy as np


@dataclass
class WallSegment:
    """벽 세그먼트 (centerline 기반)."""
    start: Tuple[float, float]
    end: Tuple[float, float]
    thickness: float = 0.2

    @property
    def midpoint(self) -> Tuple[float, float]:
        return (
            (self.start[0] + self.end[0]) / 2,
            (self.start[1] + self.end[1]) / 2,
        )

    @property
    def length(self) -> float:
        dx = self.end[0] - self.start[0]
        dy = self.end[1] - self.start[1]
        return math.sqrt(dx * dx + dy * dy)

    @property
    def direction(self) -> Tuple[float, float]:
        """정규화된 방향 벡터."""
        dx = self.end[0] - self.start[0]
        dy = self.end[1] - self.start[1]
        length = self.length
        if length < 1e-6:
            return (1.0, 0.0)
        return (dx / length, dy / length)


def _compute_outer_walls(walls: List[WallSegment]) -> List[WallSegment]:
    """모든 wall centerline 의 outer perimeter 추출.

    간단 구현:
    1. 모든 segment 의 endpoint 모음
    2. ConvexHull → 외곽
    3. 외곽 가까운 (distance < 1m) segment 만 outer 로 분류
    """
    if not walls:
        return []

    points = []
    for w in walls:
        points.append(w.start)
        points.append(w.end)
    points = np.array(points)

    if len(points) < 3:
        return walls  # 폴백: 모두 외벽으로 간주

    try:
        from scipy.spatial import ConvexHull
        hull = ConvexHull(points)
        hull_points = points[hull.vertices]

        # Shapely 가 있으면 사용, 없으면 간단 거리 계산
        try:
            from shapely.geometry import LinearRing, Point

            hull_ring = LinearRing(hull_points)

            outer = []
            for w in walls:
                mid = Point(w.midpoint)
                if hull_ring.distance(mid) < 1.0:
                    outer.append(w)
            return outer if outer else walls

        except ImportError:
            # Shapely 없으면 단순 거리 체크
            outer = []
            for w in walls:
                mx, my = w.midpoint
                min_dist = float("inf")
                for i in range(len(hull_points)):
                    p1 = hull_points[i]
                    p2 = hull_points[(i + 1) % len(hull_points)]
                    # 점-선분 거리
                    dist = _point_to_segment_dist(mx, my, p1[0], p1[1], p2[0], p2[1])
                    min_dist = min(min_dist, dist)
                if min_dist < 1.0:
                    outer.append(w)
            return outer if outer else walls

    except Exception:
        return walls  # 폴백: 모두 외벽으로 간주


def _point_to_segment_dist(
    px: float, py: float,
    x1: float, y1: float,
    x2: float, y2: float,
) -> float:
    """점 (px, py) 에서 선분 (x1,y1)-(x2,y2) 까지 거리."""
    dx = x2 - x1
    dy = y2 - y1
    if dx == 0 and dy == 0:
        return math.sqrt((px - x1) ** 2 + (py - y1) ** 2)

    t = max(0, min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)))
    proj_x = x1 + t * dx
    proj_y = y1 + t * dy
    return math.sqrt((px - proj_x) ** 2 + (py - proj_y) ** 2)


def _nearest_wall(walls: List[WallSegment], point: Tuple[float, float]) -> Tuple[Optional[WallSegment], float]:
    """주어진 점에 가장 가까운 wall segment 와 거리 반환."""
    if not walls:
        return None, float("inf")

    px, py = point
    best, best_dist = None, float("inf")

    for w in walls:
        dist = _point_to_segment_dist(px, py, w.start[0], w.start[1], w.end[0], w.end[1])
        if dist < best_dist:
            best, best_dist = w, dist

    return best, best_dist


def find_main_entrance(
    doors: List[Tuple],          # [(cx, cy, width, height, panel_angle), ...]
    walls: List[WallSegment],
    site_footprint: Optional[List] = None,  # 대지 footprint (외벽 판별 보조)
) -> Optional[Dict]:
    """
    1. 외벽만 추리기 (wall list 의 outer perimeter)
    2. 외벽 0.5m 이내에 붙은 문 후보
    3. 후보 중 width 최대 = 메인 출입구

    return None 이면 적절한 메인 출입구 없음 (warning)
    """
    if not doors or not walls:
        return None

    outer_walls = _compute_outer_walls(walls)
    if not outer_walls:
        return None

    candidates = []
    for door in doors:
        if len(door) < 3:
            continue
        cx, cy, width = door[0], door[1], door[2]
        nearest_wall, dist = _nearest_wall(outer_walls, (cx, cy))
        if dist <= 0.5:  # 외벽 0.5m 이내
            candidates.append({
                "center": (cx, cy),
                "width": width,
                "wall_segment_id": id(nearest_wall) if nearest_wall else None,
                "distance": dist,
            })

    if not candidates:
        # 외벽 매칭 실패 → 모든 문 중 가장 큰 것
        if doors:
            best_door = max(doors, key=lambda d: d[2] if len(d) > 2 else 0)
            if len(best_door) >= 3:
                return {
                    "center": (best_door[0], best_door[1]),
                    "width": best_door[2],
                    "wall_segment_id": None,
                    "confidence": 0.5,
                }
        return None

    # 외벽 후보 중 가장 큰 것
    best = max(candidates, key=lambda c: c["width"])
    best["confidence"] = 1.0
    return best


def find_primary_window_face(
    windows: List[Tuple],         # [(cx, cy, width, height, angle), ...]
    walls: List[WallSegment],
) -> Optional[Dict]:
    """
    1. 외벽 segment 마다 그 위에 붙은 창문 그룹화
    2. 창문 폭 합이 가장 큰 segment = 주 채광면
    """
    if not windows or not walls:
        return None

    outer_walls = _compute_outer_walls(walls)
    if not outer_walls:
        return None

    # 외벽 segment 별 창문 매핑
    by_wall: Dict[int, List] = {}
    for window in windows:
        if len(window) < 3:
            continue
        cx, cy, width = window[0], window[1], window[2]
        nearest, dist = _nearest_wall(outer_walls, (cx, cy))
        if nearest and dist <= 0.3:  # 외벽 0.3m 이내
            by_wall.setdefault(id(nearest), []).append(window)

    if not by_wall:
        return None

    # 가장 많이 모인 외벽
    best_id = max(by_wall.keys(), key=lambda k: sum(w[2] for w in by_wall[k] if len(w) > 2))
    best_wall = next((w for w in outer_walls if id(w) == best_id), None)
    if not best_wall:
        return None

    group = by_wall[best_id]

    return {
        "midpoint": best_wall.midpoint,
        "direction": best_wall.direction,
        "length": best_wall.length,
        "window_count": len(group),
        "total_window_width": sum(w[2] for w in group if len(w) > 2),
        "confidence": 1.0,
    }


def extract_doors_simple(
    doc,
    door_layers: List[str],
) -> List[Tuple]:
    """DXF 문서에서 문 추출 (간단 버전).

    ARC 엔티티를 문으로 간주하고 bbox 추출.

    Returns:
        [(cx, cy, width, height, angle), ...]
    """
    doors = []
    msp = doc.modelspace()
    door_set = set(layer.upper() for layer in door_layers)

    for entity in msp:
        try:
            layer = entity.dxf.layer.upper() if hasattr(entity.dxf, "layer") else ""
            if layer not in door_set:
                continue

            etype = entity.dxftype()

            if etype == "ARC":
                # ARC = 문 스윙
                cx, cy = entity.dxf.center.x, entity.dxf.center.y
                radius = entity.dxf.radius
                # 문 폭 ≈ radius (호의 반지름이 문 폭과 비슷)
                doors.append((cx, cy, radius, radius, 0.0))

            elif etype == "INSERT":
                # 블록 참조 (문 심볼)
                # 삽입점을 중심으로 추정
                cx, cy = entity.dxf.insert.x, entity.dxf.insert.y
                # 기본 폭 0.9m 추정
                doors.append((cx, cy, 0.9, 2.1, 0.0))

        except Exception:
            continue

    return doors


def extract_windows_simple(
    doc,
    window_layers: List[str],
) -> List[Tuple]:
    """DXF 문서에서 창문 추출 (간단 버전).

    LINE/LWPOLYLINE 엔티티의 bbox 기반.

    Returns:
        [(cx, cy, width, height, angle), ...]
    """
    windows = []
    msp = doc.modelspace()
    window_set = set(layer.upper() for layer in window_layers)

    # 레이어별 엔티티 그룹핑 후 bbox 계산
    layer_entities: Dict[str, List] = {}

    for entity in msp:
        try:
            layer = entity.dxf.layer.upper() if hasattr(entity.dxf, "layer") else ""
            if layer not in window_set:
                continue

            etype = entity.dxftype()

            if etype == "LINE":
                start = entity.dxf.start
                end = entity.dxf.end
                # 창문은 보통 짧은 선 여러 개로 구성
                cx = (start.x + end.x) / 2
                cy = (start.y + end.y) / 2
                width = abs(end.x - start.x)
                height = abs(end.y - start.y)
                if max(width, height) > 0.3:  # 최소 30cm
                    windows.append((cx, cy, max(width, height), min(width, height) or 0.1, 0.0))

            elif etype == "LWPOLYLINE":
                points = list(entity.get_points(format="xy"))
                if len(points) >= 2:
                    xs = [p[0] for p in points]
                    ys = [p[1] for p in points]
                    cx = (min(xs) + max(xs)) / 2
                    cy = (min(ys) + max(ys)) / 2
                    width = max(xs) - min(xs)
                    height = max(ys) - min(ys)
                    if max(width, height) > 0.3:
                        windows.append((cx, cy, max(width, height), min(width, height) or 0.1, 0.0))

        except Exception:
            continue

    return windows


def walls_from_centerline(centerline_result) -> List[WallSegment]:
    """centerline.py 결과를 WallSegment 리스트로 변환.

    centerline_result 는 services.lod.centerline.reconstruct_centerline() 결과.
    """
    segments = []

    if hasattr(centerline_result, "segments"):
        for seg in centerline_result.segments:
            if hasattr(seg, "start") and hasattr(seg, "end"):
                segments.append(WallSegment(
                    start=seg.start,
                    end=seg.end,
                    thickness=getattr(seg, "thickness", 0.2),
                ))
    elif isinstance(centerline_result, list):
        for item in centerline_result:
            if isinstance(item, dict):
                segments.append(WallSegment(
                    start=tuple(item.get("start", (0, 0))),
                    end=tuple(item.get("end", (0, 0))),
                    thickness=item.get("thickness", 0.2),
                ))
            elif hasattr(item, "start") and hasattr(item, "end"):
                segments.append(WallSegment(
                    start=item.start,
                    end=item.end,
                    thickness=getattr(item, "thickness", 0.2),
                ))

    return segments
