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


def create_wall_building_gltf(
    dxf_path: str,
    wall_layers: List[str],
    height: float = 9.0,
    wall_thickness: float = 0.15,
    output_path: str = "building.glb",
    color: Optional[Tuple[int, int, int, int]] = None
) -> bool:
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

    try:
        doc = ezdxf.readfile(dxf_path)
        msp = doc.modelspace()

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
            return False

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

        # 2) 모든 선분을 합치고 buffer로 벽 두께 부여
        merged = unary_union(geom_lines)

        # mm/cm 단위인 경우 좌표를 미터로 변환
        if dxf_scale != 1.0:
            from shapely.affinity import scale as shapely_scale
            merged = shapely_scale(merged, xfact=dxf_scale, yfact=dxf_scale, origin=(0, 0))
            logger.info(f"Scaled DXF geometry by {dxf_scale} to convert to meters")

        wall_poly = merged.buffer(wall_thickness / 2, cap_style='flat', join_style='mitre')

        # 3) 중심점 기준으로 좌표 정규화 (원점 중심)
        bounds = wall_poly.bounds  # (minx, miny, maxx, maxy)
        cx = (bounds[0] + bounds[2]) / 2
        cy = (bounds[1] + bounds[3]) / 2
        from shapely.affinity import translate
        wall_poly_centered = translate(wall_poly, xoff=-cx, yoff=-cy)

        # 4) Polygon(들)을 trimesh로 extrude
        scene = trimesh.Scene()

        # Z-up → Y-up 회전 행렬
        rot_z_to_y = np.array([
            [1,  0,  0, 0],
            [0,  0,  1, 0],
            [0, -1,  0, 0],
            [0,  0,  0, 1],
        ], dtype=np.float64)

        if color is None:
            color = (200, 200, 200, 255)

        polys = []
        if wall_poly_centered.geom_type == 'Polygon':
            polys = [wall_poly_centered]
        elif wall_poly_centered.geom_type == 'MultiPolygon':
            polys = list(wall_poly_centered.geoms)

        for i, poly in enumerate(polys):
            if poly.is_empty or not poly.is_valid:
                continue
            try:
                mesh = trimesh.creation.extrude_polygon(poly, height=height)
                mesh.apply_transform(rot_z_to_y)
                mesh.visual.vertex_colors = np.array([color] * len(mesh.vertices))
                scene.add_geometry(mesh, node_name=f"wall_{i}")
            except Exception as e:
                logger.warning(f"Failed to extrude wall polygon {i}: {e}")
                continue

        if len(scene.geometry) == 0:
            logger.error("No wall meshes created")
            return False

        scene.export(output_path, file_type='glb')

        total_verts = sum(len(m.vertices) for m in scene.geometry.values())
        total_faces = sum(len(m.faces) for m in scene.geometry.values())
        logger.info(f"Exported wall building: {len(scene.geometry)} parts, "
                     f"{total_verts} vertices, {total_faces} faces → {output_path}")
        return True

    except Exception as e:
        logger.error(f"Failed to create wall GLB: {e}")
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
