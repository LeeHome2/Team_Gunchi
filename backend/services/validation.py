"""
Module: Validation Service
건축 규정 검토 서비스
"""

from typing import List, Dict, Any, Optional
from dataclasses import dataclass
from shapely.geometry import Polygon


@dataclass
class ValidationConfig:
    """검토 기준 설정"""
    coverage_limit: float = 60.0      # 건폐율 제한 (%)
    setback_required: float = 1.5     # 이격거리 (m) - 하위호환용
    setback_road: float = 1.0         # 도로변(건축선) 이격거리 (m)
    setback_adjacent: float = 0.5     # 인접대지 이격거리 (m)
    height_limit: float = 12.0        # 높이 제한 (m)
    far_limit: Optional[float] = None # 용적률 제한 (%) - 미구현


@dataclass
class ValidationResult:
    """검토 결과"""
    is_valid: bool
    building_coverage: Dict[str, Any]
    setback: Dict[str, Any]
    height: Dict[str, Any]
    violations: List[Dict[str, str]]


# 용도지역별 기본 설정 (setback_road=도로변, setback_adjacent=인접대지)
ZONE_CONFIGS = {
    "제1종전용주거지역": ValidationConfig(
        coverage_limit=50.0,
        setback_required=2.0,
        setback_road=1.0,
        setback_adjacent=0.5,
        height_limit=10.0,
    ),
    "제2종전용주거지역": ValidationConfig(
        coverage_limit=50.0,
        setback_required=1.5,
        setback_road=1.0,
        setback_adjacent=0.5,
        height_limit=12.0,
    ),
    "제1종일반주거지역": ValidationConfig(
        coverage_limit=60.0,
        setback_required=1.5,
        setback_road=1.0,
        setback_adjacent=0.5,
        height_limit=16.0,
    ),
    "제2종일반주거지역": ValidationConfig(
        coverage_limit=60.0,
        setback_required=1.5,
        setback_road=1.0,
        setback_adjacent=0.5,
        height_limit=20.0,
    ),
    "제3종일반주거지역": ValidationConfig(
        coverage_limit=50.0,
        setback_required=1.0,
        setback_road=1.0,
        setback_adjacent=0.5,
        height_limit=None,  # 제한 없음
    ),
    "준주거지역": ValidationConfig(
        coverage_limit=70.0,
        setback_required=1.0,
        setback_road=1.0,
        setback_adjacent=0.5,
        height_limit=None,
    ),
    "일반상업지역": ValidationConfig(
        coverage_limit=80.0,
        setback_required=0.0,
        setback_road=0.0,
        setback_adjacent=0.0,
        height_limit=None,
    ),
    "준공업지역": ValidationConfig(
        coverage_limit=70.0,
        setback_required=1.0,
        setback_road=1.0,
        setback_adjacent=0.5,
        height_limit=None,
    ),
}


def get_zone_config(zone_name: str) -> ValidationConfig:
    """용도지역별 설정 반환"""
    return ZONE_CONFIGS.get(zone_name, ValidationConfig())


def calculate_building_coverage(
    site_polygon: Polygon,
    building_polygon: Polygon
) -> Dict[str, Any]:
    """
    건폐율 계산
    건폐율 = (건축면적 / 대지면적) × 100
    """
    site_area = site_polygon.area
    building_area = building_polygon.area
    coverage = (building_area / site_area) * 100

    return {
        "site_area": round(site_area, 2),
        "building_area": round(building_area, 2),
        "value": round(coverage, 1),
    }


def calculate_setback(
    site_polygon: Polygon,
    building_polygon: Polygon,
    road_edges: Optional[List[List[List[float]]]] = None,
) -> Dict[str, Any]:
    """
    이격거리 계산 (도로변/인접대지 분리)

    Args:
        site_polygon: 대지 Polygon
        building_polygon: 건물 Polygon
        road_edges: 도로변 경계 좌표 리스트 [[[x1,y1],[x2,y2]], ...]
                    None이면 전체 경계를 인접대지로 간주

    Returns:
        {
            "min_distance_m": 전체 최소 거리 (하위호환),
            "min_distance_road_m": 도로변 최소 거리,
            "min_distance_adjacent_m": 인접대지 최소 거리,
            "is_within_site": 대지 내 포함 여부,
        }
    """
    from shapely.geometry import LineString, Point

    site_boundary = site_polygon.exterior
    building_boundary = building_polygon.exterior

    # 건물이 대지 밖으로 나갔는지 확인
    is_within = site_polygon.contains(building_polygon)

    # 전체 최소 거리 (하위호환용)
    min_distance = site_boundary.distance(building_boundary)

    # 도로변 경계가 없으면 전체를 인접대지로 간주
    if not road_edges:
        return {
            "min_distance_m": round(min_distance, 2),
            "min_distance_road_m": None,
            "min_distance_adjacent_m": round(min_distance, 2),
            "is_within_site": is_within,
        }

    # 도로변 경계 LineString 생성
    road_lines = []
    for edge in road_edges:
        if len(edge) >= 2:
            try:
                line = LineString(edge)
                if line.is_valid and line.length > 0:
                    road_lines.append(line)
            except Exception:
                pass

    if not road_lines:
        return {
            "min_distance_m": round(min_distance, 2),
            "min_distance_road_m": None,
            "min_distance_adjacent_m": round(min_distance, 2),
            "is_within_site": is_within,
        }

    # 대지 경계를 도로변/인접대지로 분리
    site_coords = list(site_boundary.coords)
    min_road_dist = float('inf')
    min_adjacent_dist = float('inf')

    # 대지 경계의 각 변(segment)에 대해 검사
    for i in range(len(site_coords) - 1):
        segment = LineString([site_coords[i], site_coords[i + 1]])
        segment_dist = segment.distance(building_boundary)

        # 이 segment가 도로변인지 확인 (도로 라인과 겹치거나 매우 가까우면)
        is_road_segment = False
        for road_line in road_lines:
            # segment의 중점이 도로 라인에 가까우면 도로변으로 판단
            mid_point = segment.interpolate(0.5, normalized=True)
            if road_line.distance(mid_point) < 0.5:  # 0.5m 이내면 도로변
                is_road_segment = True
                break

        if is_road_segment:
            min_road_dist = min(min_road_dist, segment_dist)
        else:
            min_adjacent_dist = min(min_adjacent_dist, segment_dist)

    return {
        "min_distance_m": round(min_distance, 2),
        "min_distance_road_m": round(min_road_dist, 2) if min_road_dist != float('inf') else None,
        "min_distance_adjacent_m": round(min_adjacent_dist, 2) if min_adjacent_dist != float('inf') else None,
        "is_within_site": is_within,
    }


def calculate_height_check(
    building_height: float,
    height_limit: Optional[float]
) -> Dict[str, Any]:
    """높이 제한 검토"""
    if height_limit is None:
        return {
            "value_m": building_height,
            "limit_m": None,
            "status": "OK",
            "message": "높이 제한 없음",
        }

    is_ok = building_height <= height_limit
    return {
        "value_m": building_height,
        "limit_m": height_limit,
        "status": "OK" if is_ok else "VIOLATION",
    }


def validate_placement(
    site_footprint: List[List[float]],
    building_footprint: List[List[float]],
    building_height: float,
    config: Optional[ValidationConfig] = None,
    road_edges: Optional[List[List[List[float]]]] = None,
) -> ValidationResult:
    """
    건축 배치 검토 메인 함수

    Args:
        site_footprint: 대지 좌표 [[lon, lat], ...]
        building_footprint: 건물 좌표 [[lon, lat], ...]
        building_height: 건물 높이 (m)
        config: 검토 기준 설정 (None이면 기본값 사용)

    Returns:
        ValidationResult: 검토 결과
    """
    if config is None:
        config = ValidationConfig()

    # Polygon 생성
    site_polygon = Polygon(site_footprint)
    building_polygon = Polygon(building_footprint)

    violations = []

    # 1. 건폐율 검토
    coverage = calculate_building_coverage(site_polygon, building_polygon)
    coverage_ok = coverage["value"] <= config.coverage_limit
    coverage["limit"] = config.coverage_limit
    coverage["status"] = "OK" if coverage_ok else "VIOLATION"

    if not coverage_ok:
        violations.append({
            "code": "BCR_EXCEED",
            "message": f"건폐율 {config.coverage_limit}% 초과 (현재 {coverage['value']}%)"
        })

    # 2. 이격거리 검토 (도로변/인접대지 분리)
    setback = calculate_setback(site_polygon, building_polygon, road_edges)

    # 도로변/인접대지 분리 검증
    setback["required_road_m"] = config.setback_road
    setback["required_adjacent_m"] = config.setback_adjacent
    setback["required_m"] = config.setback_required  # 하위호환

    road_ok = True
    adjacent_ok = True

    # 도로변 이격거리 검증
    if setback.get("min_distance_road_m") is not None:
        road_ok = setback["min_distance_road_m"] >= config.setback_road
        if not road_ok:
            violations.append({
                "code": "SETBACK_ROAD_VIOLATION",
                "message": f"도로변 이격거리 부족 (필요 {config.setback_road}m, 현재 {setback['min_distance_road_m']}m)"
            })

    # 인접대지 이격거리 검증
    if setback.get("min_distance_adjacent_m") is not None:
        adjacent_ok = setback["min_distance_adjacent_m"] >= config.setback_adjacent
        if not adjacent_ok:
            violations.append({
                "code": "SETBACK_ADJACENT_VIOLATION",
                "message": f"인접대지 이격거리 부족 (필요 {config.setback_adjacent}m, 현재 {setback['min_distance_adjacent_m']}m)"
            })

    # road_edges가 없을 경우 하위호환 (단일 기준 적용)
    if road_edges is None:
        # 인접대지 기준으로 검증 (더 느슨한 기준)
        setback_ok = setback["min_distance_m"] >= config.setback_adjacent
        if not setback_ok and adjacent_ok:  # 위에서 이미 추가 안했으면
            violations.append({
                "code": "SETBACK_VIOLATION",
                "message": f"이격거리 부족 (필요 {config.setback_adjacent}m, 현재 {setback['min_distance_m']}m)"
            })
    else:
        setback_ok = road_ok and adjacent_ok

    setback["status"] = "OK" if setback_ok else "VIOLATION"

    if not setback["is_within_site"]:
        violations.append({
            "code": "OUT_OF_SITE",
            "message": "건물이 대지 경계를 벗어남"
        })

    # 3. 높이 검토
    height = calculate_height_check(building_height, config.height_limit)
    if height["status"] == "VIOLATION":
        violations.append({
            "code": "HEIGHT_EXCEED",
            "message": f"높이제한 {config.height_limit}m 초과 (현재 {building_height}m)"
        })

    return ValidationResult(
        is_valid=len(violations) == 0,
        building_coverage=coverage,
        setback=setback,
        height=height,
        violations=violations,
    )


def validate_parking(
    required_total: int,
    provided_total: int,
    parking_area_m2: float,
    site_area_m2: float,
) -> Dict[str, Any]:
    """
    주차 규정 검토.

    Returns:
        {
            "required": int,
            "provided": int,
            "is_sufficient": bool,
            "parking_area_m2": float,
            "parking_ratio_pct": float,
            "status": "OK" | "VIOLATION",
            "message": str,
        }
    """
    is_sufficient = provided_total >= required_total
    ratio = (parking_area_m2 / site_area_m2) * 100 if site_area_m2 > 0 else 0.0

    status = "OK" if is_sufficient else "VIOLATION"
    message = (
        f"주차 기준 충족 ({provided_total}/{required_total}대)"
        if is_sufficient
        else f"주차 기준 미달 ({provided_total}/{required_total}대)"
    )

    return {
        "required": required_total,
        "provided": provided_total,
        "is_sufficient": is_sufficient,
        "parking_area_m2": round(parking_area_m2, 2),
        "parking_ratio_pct": round(ratio, 1),
        "status": status,
        "message": message,
    }


def validate_with_zone(
    site_footprint: List[List[float]],
    building_footprint: List[List[float]],
    building_height: float,
    zone_name: str,
    road_edges: Optional[List[List[List[float]]]] = None,
) -> ValidationResult:
    """
    용도지역 기반 검토

    Args:
        zone_name: 용도지역명 (예: "제1종일반주거지역")
        road_edges: 도로변 경계 좌표 리스트 [[[x1,y1],[x2,y2]], ...]
    """
    config = get_zone_config(zone_name)
    return validate_placement(
        site_footprint,
        building_footprint,
        building_height,
        config,
        road_edges,
    )
