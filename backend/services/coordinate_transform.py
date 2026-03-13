"""
좌표계 변환 서비스
PyProj를 사용하여 다양한 좌표계 간 변환을 수행합니다.
"""

from pyproj import Transformer, CRS
from typing import List, Tuple, Optional
import logging

logger = logging.getLogger(__name__)

# 자주 사용되는 EPSG 코드
EPSG_WGS84 = 4326           # GPS 좌표 (경위도)
EPSG_UTM52N = 32652         # UTM Zone 52N (한국)
EPSG_KOREA_TM = 5186        # Korea 2000 / Central Belt
EPSG_KOREA_TM_WEST = 5185   # Korea 2000 / West Belt
EPSG_KOREA_TM_EAST = 5187   # Korea 2000 / East Belt


class CoordinateTransformer:
    """좌표계 변환 클래스"""

    def __init__(self, source_epsg: int = EPSG_KOREA_TM, target_epsg: int = EPSG_WGS84):
        """
        Args:
            source_epsg: 원본 좌표계 EPSG 코드
            target_epsg: 대상 좌표계 EPSG 코드
        """
        self.source_epsg = source_epsg
        self.target_epsg = target_epsg
        self.transformer = Transformer.from_crs(
            CRS.from_epsg(source_epsg),
            CRS.from_epsg(target_epsg),
            always_xy=True  # (x, y) = (lon, lat) 순서 보장
        )
        logger.info(f"Transformer created: EPSG:{source_epsg} -> EPSG:{target_epsg}")

    def transform_point(self, x: float, y: float) -> Tuple[float, float]:
        """
        단일 좌표 변환

        Args:
            x: X 좌표 (또는 경도)
            y: Y 좌표 (또는 위도)

        Returns:
            변환된 (x, y) 좌표
        """
        return self.transformer.transform(x, y)

    def transform_points(self, points: List[List[float]]) -> List[List[float]]:
        """
        좌표 리스트 변환

        Args:
            points: [[x, y], [x, y], ...] 형식의 좌표

        Returns:
            변환된 좌표 리스트
        """
        result = []
        for point in points:
            x, y = self.transform_point(point[0], point[1])
            result.append([x, y])
        return result


def transform_coordinates(
    coordinates: List[List[float]],
    source_epsg: int = EPSG_KOREA_TM,
    target_epsg: int = EPSG_WGS84
) -> List[List[float]]:
    """
    좌표 리스트 변환 유틸리티 함수

    Args:
        coordinates: 좌표 리스트
        source_epsg: 원본 EPSG
        target_epsg: 대상 EPSG

    Returns:
        변환된 좌표 리스트
    """
    transformer = CoordinateTransformer(source_epsg, target_epsg)
    return transformer.transform_points(coordinates)


def get_local_to_wgs84_transformer(local_epsg: int) -> CoordinateTransformer:
    """
    로컬 좌표계에서 WGS84로 변환하는 Transformer 생성
    """
    return CoordinateTransformer(local_epsg, EPSG_WGS84)


def get_wgs84_to_local_transformer(local_epsg: int) -> CoordinateTransformer:
    """
    WGS84에서 로컬 좌표계로 변환하는 Transformer 생성
    """
    return CoordinateTransformer(EPSG_WGS84, local_epsg)


def detect_korean_zone(longitude: float) -> int:
    """
    경도를 기반으로 한국 TM 좌표계 존 결정

    Args:
        longitude: WGS84 경도

    Returns:
        적절한 EPSG 코드
    """
    if longitude < 126.0:
        return EPSG_KOREA_TM_WEST   # 서부
    elif longitude > 128.0:
        return EPSG_KOREA_TM_EAST   # 동부
    else:
        return EPSG_KOREA_TM        # 중부


def meters_to_degrees(
    meters_x: float,
    meters_y: float,
    reference_lat: float
) -> Tuple[float, float]:
    """
    미터 단위 거리를 도(degree) 단위로 변환

    Args:
        meters_x: 동서 방향 거리 (m)
        meters_y: 남북 방향 거리 (m)
        reference_lat: 기준 위도

    Returns:
        (경도 차이, 위도 차이)
    """
    import math

    # 지구 반경 (m)
    EARTH_RADIUS = 6378137.0

    # 위도 1도당 미터
    lat_per_meter = 1.0 / (math.pi * EARTH_RADIUS / 180.0)

    # 경도 1도당 미터 (위도에 따라 변함)
    lon_per_meter = lat_per_meter / math.cos(math.radians(reference_lat))

    return (meters_x * lon_per_meter, meters_y * lat_per_meter)


def degrees_to_meters(
    degrees_lon: float,
    degrees_lat: float,
    reference_lat: float
) -> Tuple[float, float]:
    """
    도(degree) 단위를 미터 단위로 변환

    Args:
        degrees_lon: 경도 차이
        degrees_lat: 위도 차이
        reference_lat: 기준 위도

    Returns:
        (동서 거리(m), 남북 거리(m))
    """
    import math

    EARTH_RADIUS = 6378137.0

    meters_per_lat = math.pi * EARTH_RADIUS / 180.0
    meters_per_lon = meters_per_lat * math.cos(math.radians(reference_lat))

    return (degrees_lon * meters_per_lon, degrees_lat * meters_per_lat)


def calculate_area_wgs84(coordinates: List[List[float]]) -> float:
    """
    WGS84 좌표로 면적 계산 (제곱미터)

    정확한 계산을 위해 UTM으로 변환 후 계산
    """
    from shapely.geometry import Polygon

    if len(coordinates) < 3:
        return 0.0

    # 중심점 계산
    center_lon = sum(p[0] for p in coordinates) / len(coordinates)
    center_lat = sum(p[1] for p in coordinates) / len(coordinates)

    # UTM 존 결정
    utm_zone = int((center_lon + 180) / 6) + 1
    is_northern = center_lat >= 0
    utm_epsg = 32600 + utm_zone if is_northern else 32700 + utm_zone

    # UTM으로 변환
    transformer = CoordinateTransformer(EPSG_WGS84, utm_epsg)
    utm_coords = transformer.transform_points(coordinates)

    # 면적 계산
    polygon = Polygon(utm_coords)
    return polygon.area
