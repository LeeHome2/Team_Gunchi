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


    def extract_road_lines(
        self,
        road_layer_names: Optional[List[str]] = None,
    ) -> List[List[Tuple[float, float]]]:
        """
        도로 중심선 추출.

        DXF 레이어명에 'road', 'ROAD', '도로' 등이 포함된 레이어에서
        LINE / POLYLINE / LWPOLYLINE을 추출하여 좌표 리스트로 반환.

        Args:
            road_layer_names: 도로 레이어 이름 목록 (None이면 자동 탐지)

        Returns:
            [[(x1,y1), (x2,y2), ...], ...] 도로 중심선 리스트
        """
        if not self.doc:
            return []

        # 도로 레이어 자동 탐지
        if road_layer_names is None:
            road_keywords = ['road', 'ROAD', '도로', 'street', 'STREET', '차도', '진입로']
            all_layers = self.get_layers()
            road_layer_names = [
                layer for layer in all_layers
                if any(kw.lower() in layer.lower() for kw in road_keywords)
            ]

        if not road_layer_names:
            logger.info("No road layers detected in DXF")
            return []

        road_lines: List[List[Tuple[float, float]]] = []
        modelspace = self.doc.modelspace()

        for entity in modelspace:
            if entity.dxf.layer not in road_layer_names:
                continue

            if entity.dxftype() == "LINE":
                start = (entity.dxf.start[0], entity.dxf.start[1])
                end = (entity.dxf.end[0], entity.dxf.end[1])
                road_lines.append([start, end])

            elif entity.dxftype() == "LWPOLYLINE":
                points = [(p[0], p[1]) for p in entity.get_points()]
                if len(points) >= 2:
                    road_lines.append(points)

            elif entity.dxftype() == "POLYLINE":
                points = [(v.dxf.location[0], v.dxf.location[1]) for v in entity.vertices]
                if len(points) >= 2:
                    road_lines.append(points)

        logger.info(f"Extracted {len(road_lines)} road lines from layers {road_layer_names}")
        return road_lines


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

    # DXF 단위 감지: $INSUNITS 매핑 (inch/foot 등 영미 단위까지 처리)
    # 1=in 2=ft 4=mm 5=cm 6=m 8=microinch 9=mil 10=yard 14=dm 15=dam 16=hm 21=us-ft
    INSUNITS_SCALE = {
        1: 0.0254, 2: 0.3048, 4: 0.001, 5: 0.01, 6: 1.0,
        8: 2.54e-8, 9: 2.54e-5, 10: 0.9144,
        14: 0.1, 15: 10.0, 16: 100.0, 21: 0.3048006,
    }
    dxf_unit_scale = 1.0  # 기본: 미터
    insunits_scale = None  # $INSUNITS에서 추출한 스케일 (검증 후 사용)
    auto_detected_scale = 1.0  # 좌표 범위 기반 자동 감지 스케일

    try:
        # 1) $INSUNITS 헤더 읽기 (나중에 검증)
        insunits = parser.doc.header.get('$INSUNITS', 0)
        if insunits in INSUNITS_SCALE:
            insunits_scale = INSUNITS_SCALE[insunits]
            logger.info(f"DXF header: INSUNITS={insunits}, scale={insunits_scale}")

        # 2) 좌표 범위로 단위 자동 감지 (항상 수행)
        bounds = info["bounds"]
        extent = max(bounds["max_x"] - bounds["min_x"], bounds["max_y"] - bounds["min_y"])

        if extent > 500:
            auto_detected_scale = 0.001  # mm
            logger.info(f"Auto-detected mm units: extent={extent:.0f}")
        elif extent > 100:
            auto_detected_scale = 0.0254  # inches
            logger.info(f"Auto-detected inch units: extent={extent:.0f}")
        elif extent > 5:
            # 5-100 범위: feet 가능성 확인
            converted = extent * 0.3048
            if 3 < converted < 100:  # 합리적인 건물 크기
                auto_detected_scale = 0.3048  # feet
                logger.info(f"Auto-detected feet units: extent={extent:.1f}ft → {converted:.1f}m")
        elif extent >= 1 and extent <= 5:
            # 1-5 범위: feet일 가능성 높음
            auto_detected_scale = 0.3048
            logger.info(f"Auto-detected feet units (small): extent={extent:.2f}ft")
        elif extent >= 0.1 and extent < 1:
            # 0.1-1 범위: 축척 도면 가능성 (1:100 또는 1:50)
            scaled_100 = extent * 100
            scaled_50 = extent * 50
            if 5 < scaled_100 < 200:
                auto_detected_scale = 100.0
                logger.info(f"Auto-detected 1:100 scale drawing: extent={extent:.3f}")
            elif 5 < scaled_50 < 100:
                auto_detected_scale = 50.0
                logger.info(f"Auto-detected 1:50 scale drawing: extent={extent:.3f}")
            else:
                auto_detected_scale = 100.0
                logger.info(f"Default 1:100 scale for small extent: {extent:.3f}")
        elif extent < 0.1:
            # 0.1 미만: 1:1000 축척 가능성 또는 매우 작은 도면
            scaled_1000 = extent * 1000
            if 5 < scaled_1000 < 500:
                auto_detected_scale = 1000.0
                logger.info(f"Auto-detected 1:1000 scale drawing: extent={extent:.4f}")
            else:
                auto_detected_scale = 100.0
                logger.info(f"Very small extent {extent:.4f}, defaulting to 1:100 scale")
        else:
            logger.info(f"Extent={extent:.1f}, assuming meters")

        # 3) 최종 스케일 결정: $INSUNITS vs 자동 감지
        # $INSUNITS 적용 결과가 너무 작으면(3m 미만) 자동 감지 스케일 사용
        if insunits_scale is not None:
            insunits_result = extent * insunits_scale
            auto_result = extent * auto_detected_scale

            if insunits_result < 3:  # 3m 미만 → 헤더가 잘못됐을 가능성
                logger.warning(
                    f"$INSUNITS result too small ({insunits_result:.2f}m), "
                    f"ignoring header and using auto-detected scale {auto_detected_scale} → {auto_result:.1f}m"
                )
                dxf_unit_scale = auto_detected_scale
            else:
                dxf_unit_scale = insunits_scale
                logger.info(f"Using $INSUNITS scale {insunits_scale} → {insunits_result:.1f}m")
        else:
            dxf_unit_scale = auto_detected_scale
            logger.info(f"Using auto-detected scale {auto_detected_scale} → {extent * auto_detected_scale:.1f}m")

    except Exception as e:
        logger.warning(f"Failed to detect DXF units: {e}")

    # 단위 보정: 모든 좌표 및 치수를 미터 단위로 변환
    if dxf_unit_scale != 1.0:
        # 면적 (제곱 스케일)
        info["area"] = info["area"] * (dxf_unit_scale ** 2)
        # 둘레 (선형 스케일)
        info["perimeter"] = info["perimeter"] * dxf_unit_scale
        # footprint 좌표
        coordinates = [[x * dxf_unit_scale, y * dxf_unit_scale] for x, y in coordinates]
        # 중심점
        info["centroid"] = [info["centroid"][0] * dxf_unit_scale, info["centroid"][1] * dxf_unit_scale]
        # 바운딩 박스
        info["bounds"]["min_x"] *= dxf_unit_scale
        info["bounds"]["min_y"] *= dxf_unit_scale
        info["bounds"]["max_x"] *= dxf_unit_scale
        info["bounds"]["max_y"] *= dxf_unit_scale
        logger.info(f"Applied scale {dxf_unit_scale}: area={info['area']:.2f}m², bounds={info['bounds']['max_x']-info['bounds']['min_x']:.2f}x{info['bounds']['max_y']-info['bounds']['min_y']:.2f}m")

    # 엔티티 정보 추출 (AI 분류용)
    entities = []
    total_entities = 0
    try:
        modelspace = parser.doc.modelspace()
        for entity in modelspace:
            total_entities += 1
            entities.append({
                "type": entity.dxftype(),
                "layer": entity.dxf.layer,
                "handle": entity.dxf.handle if hasattr(entity.dxf, 'handle') else str(total_entities),
            })
    except Exception as e:
        logger.warning(f"Failed to extract entities: {e}")

    # 도로 중심선 추출 (주차 진입로용)
    road_lines = parser.extract_road_lines()

    return {
        "success": True,
        "footprint": coordinates,
        "area": info["area"],
        "centroid": info["centroid"],
        "bounds": {
            **info["bounds"],
            "layers": layers
        },
        "perimeter": info["perimeter"],
        "available_layers": layers,
        "total_entities": total_entities,
        "entities": entities,
        "road_lines": road_lines,
        "unit_scale": dxf_unit_scale,  # 적용된 단위 변환 스케일 (디버깅용)
    }
