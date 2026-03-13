"""
glTF/GLB 모델 생성 서비스
건물 footprint를 3D 매스로 변환하여 glTF 형식으로 내보냅니다.
"""

import numpy as np
import trimesh
from typing import List, Optional, Tuple
import logging

logger = logging.getLogger(__name__)


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

    # Extrusion으로 3D 메쉬 생성
    mesh = trimesh.creation.extrude_polygon(
        polygon,
        height=height
    )

    # 바닥 높이 조정
    if base_height != 0:
        mesh.apply_translation([0, 0, base_height])

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

        # 색상 설정
        if color is None:
            color = (180, 180, 180, 255)  # 기본 회색

        # trimesh에서 vertex colors 설정
        mesh.visual.vertex_colors = np.array([color] * len(mesh.vertices))

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
            mesh.visual.vertex_colors = np.array([color] * len(mesh.vertices))

            scene.add_geometry(mesh, node_name=f"floor_{floor_num + 1}")

        scene.export(output_path, file_type='glb')
        logger.info(f"Exported multi-floor building ({floors} floors) to: {output_path}")
        return True

    except Exception as e:
        logger.error(f"Failed to create multi-floor building: {e}")
        return False


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
