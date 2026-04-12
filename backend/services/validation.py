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
    setback_required: float = 1.5     # 이격거리 (m)
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


# 용도지역별 기본 설정
ZONE_CONFIGS = {
    "제1종전용주거지역": ValidationConfig(
        coverage_limit=50.0,
        setback_required=2.0,
        height_limit=10.0,
    ),
    "제2종전용주거지역": ValidationConfig(
        coverage_limit=50.0,
        setback_required=1.5,
        height_limit=12.0,
    ),
    "제1종일반주거지역": ValidationConfig(
        coverage_limit=60.0,
        setback_required=1.5,
        height_limit=16.0,
    ),
    "제2종일반주거지역": ValidationConfig(
        coverage_limit=60.0,
        setback_required=1.5,
        height_limit=20.0,
    ),
    "제3종일반주거지역": ValidationConfig(
        coverage_limit=50.0,
        setback_required=1.5,
        height_limit=None,  # 제한 없음
    ),
    "준주거지역": ValidationConfig(
        coverage_limit=70.0,
        setback_required=1.0,
        height_limit=None,
    ),
    "일반상업지역": ValidationConfig(
        coverage_limit=80.0,
        setback_required=0.0,
        height_limit=None,
    ),
    "준공업지역": ValidationConfig(
        coverage_limit=70.0,
        setback_required=1.0,
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
    building_polygon: Polygon
) -> Dict[str, Any]:
    """
    이격거리 계산
    대지경계선에서 건물까지의 최소 거리
    """
    site_boundary = site_polygon.exterior
    building_boundary = building_polygon.exterior
    min_distance = site_boundary.distance(building_boundary)

    # 건물이 대지 밖으로 나갔는지 확인
    is_within = site_polygon.contains(building_polygon)

    return {
        "min_distance_m": round(min_distance, 2),
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
    config: Optional[ValidationConfig] = None
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

    # 2. 이격거리 검토
    setback = calculate_setback(site_polygon, building_polygon)
    setback_ok = setback["min_distance_m"] >= config.setback_required
    setback["required_m"] = config.setback_required
    setback["status"] = "OK" if setback_ok else "VIOLATION"

    if not setback_ok:
        violations.append({
            "code": "SETBACK_VIOLATION",
            "message": f"이격거리 부족 (필요 {config.setback_required}m, 현재 {setback['min_distance_m']}m)"
        })

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
    zone_name: str
) -> ValidationResult:
    """
    용도지역 기반 검토

    Args:
        zone_name: 용도지역명 (예: "제1종일반주거지역")
    """
    config = get_zone_config(zone_name)
    return validate_placement(
        site_footprint,
        building_footprint,
        building_height,
        config
    )
