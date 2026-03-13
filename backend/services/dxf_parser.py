"""
DXF 파일 파싱 서비스
ezdxf를 사용하여 DXF 파일에서 건물 footprint를 추출합니다.
"""

import ezdxf
from shapely.geometry import Polygon, MultiPolygon
from shapely.ops import unary_union
from typing import List, Tuple, Optional, Dict, Any
import logging

logger = logging.getLogger(__name__)


class DXFParser:
    """DXF 파일 파싱 클래스"""

    def __init__(self):
        self.doc = None

    def load_file(self, file_path: str) -> bool:
        """
        DXF 파일 로드

        Args:
            file_path: DXF 파일 경로

        Returns:
            성공 여부
        """
        try:
            self.doc = ezdxf.readfile(file_path)
            logger.info(f"DXF file loaded: {file_path}")
            return True
        except Exception as e:
            logger.error(f"Failed to load DXF file: {e}")
            return False

    def get_layers(self) -> List[str]:
        """
        사용 가능한 레이어 목록 반환
        """
        if not self.doc:
            return []
        return [layer.dxf.name for layer in self.doc.layers]

    def extract_polylines(self, layer_name: Optional[str] = None) -> List[List[Tuple[float, float]]]:
        """
        POLYLINE 및 LWPOLYLINE 엔티티 추출

        Args:
            layer_name: 특정 레이어만 추출 (None이면 모든 레이어)

        Returns:
            폴리라인 좌표 리스트
        """
        if not self.doc:
            logger.error("No DXF document loaded")
            return []

        polylines = []
        modelspace = self.doc.modelspace()

        for entity in modelspace:
            # 레이어 필터링
            if layer_name and entity.dxf.layer != layer_name:
                continue

            # LWPOLYLINE (가벼운 폴리라인)
            if entity.dxftype() == "LWPOLYLINE":
                points = [(p[0], p[1]) for p in entity.get_points()]
                if len(points) >= 3:
                    polylines.append(points)

            # POLYLINE (3D 폴리라인)
            elif entity.dxftype() == "POLYLINE":
                points = [(v.dxf.location[0], v.dxf.location[1]) for v in entity.vertices]
                if len(points) >= 3:
                    polylines.append(points)

            # LINE들을 연결하여 폴리라인 구성 (추후 구현)
            # elif entity.dxftype() == "LINE":
            #     pass

        logger.info(f"Extracted {len(polylines)} polylines")
        return polylines

    def extract_lines(self, layer_name: Optional[str] = None) -> List[Tuple[Tuple[float, float], Tuple[float, float]]]:
        """
        LINE 엔티티 추출

        Returns:
            선분 리스트 [((x1, y1), (x2, y2)), ...]
        """
        if not self.doc:
            return []

        lines = []
        modelspace = self.doc.modelspace()

        for entity in modelspace:
            if layer_name and entity.dxf.layer != layer_name:
                continue

            if entity.dxftype() == "LINE":
                start = (entity.dxf.start[0], entity.dxf.start[1])
                end = (entity.dxf.end[0], entity.dxf.end[1])
                lines.append((start, end))

        logger.info(f"Extracted {len(lines)} lines")
        return lines

    def extract_footprint(self, layer_name: Optional[str] = None) -> Optional[Polygon]:
        """
        외곽선(footprint) 추출
        여러 폴리라인을 하나의 Polygon으로 병합

        Args:
            layer_name: 특정 레이어만 추출

        Returns:
            Shapely Polygon 객체
        """
        polylines = self.extract_polylines(layer_name)

        if not polylines:
            logger.error("No polylines found")
            return None

        # 폴리라인을 Polygon으로 변환
        polygons = []
        for points in polylines:
            if len(points) >= 3:
                try:
                    poly = Polygon(points)
                    if poly.is_valid:
                        polygons.append(poly)
                    else:
                        # 유효하지 않은 폴리곤 수정 시도
                        fixed = poly.buffer(0)
                        if fixed.is_valid and not fixed.is_empty:
                            polygons.append(fixed)
                except Exception as e:
                    logger.warning(f"Invalid polygon: {e}")

        if not polygons:
            logger.error("No valid polygons created")
            return None

        # 여러 Polygon을 하나로 병합
        if len(polygons) == 1:
            footprint = polygons[0]
        else:
            footprint = unary_union(polygons)
            if isinstance(footprint, MultiPolygon):
                # 가장 큰 Polygon 선택
                footprint = max(footprint.geoms, key=lambda p: p.area)

        logger.info(f"Footprint extracted: area={footprint.area:.2f}")
        return footprint

    def get_footprint_coordinates(self, footprint: Polygon) -> List[List[float]]:
        """
        Footprint 좌표 리스트 반환

        Args:
            footprint: Shapely Polygon 객체

        Returns:
            [[x, y], [x, y], ...] 형식의 좌표 리스트
        """
        if not footprint:
            return []

        return [[x, y] for x, y in footprint.exterior.coords[:-1]]

    def get_footprint_info(self, footprint: Polygon) -> Dict[str, Any]:
        """
        Footprint 정보 추출

        Args:
            footprint: Shapely Polygon 객체

        Returns:
            면적, 중심점 등의 정보
        """
        if not footprint:
            return {}

        centroid = footprint.centroid
        bounds = footprint.bounds  # (minx, miny, maxx, maxy)

        return {
            "area": footprint.area,
            "perimeter": footprint.length,
            "centroid": [centroid.x, centroid.y],
            "bounds": {
                "min_x": bounds[0],
                "min_y": bounds[1],
                "max_x": bounds[2],
                "max_y": bounds[3]
            }
        }


def parse_dxf_file(file_path: str, layer_name: Optional[str] = None) -> Dict[str, Any]:
    """
    DXF 파일을 파싱하여 footprint 정보 반환

    Args:
        file_path: DXF 파일 경로
        layer_name: 레이어 이름 (선택)

    Returns:
        footprint 정보 딕셔너리
    """
    parser = DXFParser()

    if not parser.load_file(file_path):
        return {"success": False, "error": "Failed to load DXF file"}

    # 사용 가능한 레이어 정보
    layers = parser.get_layers()

    footprint = parser.extract_footprint(layer_name)

    if not footprint:
        return {
            "success": False,
            "error": "No footprint found",
            "available_layers": layers
        }

    coordinates = parser.get_footprint_coordinates(footprint)
    info = parser.get_footprint_info(footprint)

    return {
        "success": True,
        "footprint": coordinates,
        "area": info["area"],
        "centroid": info["centroid"],
        "bounds": info["bounds"],
        "perimeter": info["perimeter"],
        "available_layers": layers
    }
