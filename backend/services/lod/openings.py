"""
개구부 (door/window) 추출 및 벽면 매핑.

DXF에서 개구부 엔티티를 추출하고 가장 가까운 벽 세그먼트에 매핑.
Phase 3: 텍스처 개구부 (색칠된 사각형, 구멍 X)
"""

import logging
from dataclasses import dataclass
from typing import List, Tuple, Optional, Dict
import numpy as np
import ezdxf
from ezdxf.entities import Insert, Line, LWPolyline

from .wall_types import WallSegment, CenterlineResult

logger = logging.getLogger(__name__)


# ============= 데이터 타입 =============

@dataclass
class Opening:
    """개구부 (문 또는 창문).

    Attributes:
        center: 개구부 중심점 (x, y)
        width: 폭 (m)
        height: 높이 (m), None이면 기본값 사용
        bottom_z: 바닥에서 개구부 하단까지 높이
        opening_type: 'door' 또는 'window'
        layer: 원본 DXF 레이어명
    """
    center: Tuple[float, float]
    width: float
    height: Optional[float] = None
    bottom_z: float = 0.0
    opening_type: str = 'window'  # 'door' or 'window'
    layer: Optional[str] = None


@dataclass
class MappedOpening:
    """벽에 매핑된 개구부.

    Attributes:
        opening: 원본 개구부
        wall_segment: 매핑된 벽 세그먼트
        wall_position: 벽 시작점에서의 위치 (0.0~1.0)
        distance: 벽까지의 거리 (m)
    """
    opening: Opening
    wall_segment: WallSegment
    wall_position: float  # 벽 시작점 기준 상대 위치
    distance: float  # 벽까지 거리


# ============= 상수 =============

# 기본 개구부 크기
DEFAULT_DOOR_WIDTH = 0.9
DEFAULT_DOOR_HEIGHT = 2.1
DEFAULT_WINDOW_WIDTH = 1.2
DEFAULT_WINDOW_HEIGHT = 1.2
DEFAULT_WINDOW_BOTTOM_Z = 0.9  # 창문 하단 높이

# 매핑 임계값
MAX_MAPPING_DISTANCE = 1.0  # 벽에서 최대 1m 이내


# ============= 개구부 추출 =============

def _get_entity_bbox(entity) -> Optional[Tuple[Tuple[float, float], Tuple[float, float]]]:
    """엔티티의 바운딩 박스 반환 ((min_x, min_y), (max_x, max_y))"""
    try:
        if entity.dxftype() == 'LINE':
            x1, y1 = entity.dxf.start.x, entity.dxf.start.y
            x2, y2 = entity.dxf.end.x, entity.dxf.end.y
            return ((min(x1, x2), min(y1, y2)), (max(x1, x2), max(y1, y2)))

        elif entity.dxftype() == 'LWPOLYLINE':
            points = list(entity.get_points('xy'))
            if not points:
                return None
            xs = [p[0] for p in points]
            ys = [p[1] for p in points]
            return ((min(xs), min(ys)), (max(xs), max(ys)))

        elif entity.dxftype() == 'INSERT':
            # 블록 참조 - 삽입점 기준으로 추정
            x, y = entity.dxf.insert.x, entity.dxf.insert.y
            # 블록 크기 추정 (스케일 적용)
            sx = entity.dxf.xscale if hasattr(entity.dxf, 'xscale') else 1.0
            sy = entity.dxf.yscale if hasattr(entity.dxf, 'yscale') else 1.0
            # 기본 크기 가정
            half_w = 0.5 * abs(sx)
            half_h = 0.5 * abs(sy)
            return ((x - half_w, y - half_h), (x + half_w, y + half_h))

        elif entity.dxftype() == 'ARC':
            # 호 - 중심점 기준
            cx, cy = entity.dxf.center.x, entity.dxf.center.y
            r = entity.dxf.radius
            return ((cx - r, cy - r), (cx + r, cy + r))

        return None
    except Exception as e:
        logger.debug(f"바운딩 박스 추출 실패: {e}")
        return None


def extract_openings(
    dxf_path: str,
    door_layers: List[str],
    window_layers: List[str]
) -> List[Opening]:
    """DXF 파일에서 개구부 추출.

    Args:
        dxf_path: DXF 파일 경로
        door_layers: 문 레이어 이름 목록
        window_layers: 창문 레이어 이름 목록

    Returns:
        개구부 목록
    """
    openings = []

    try:
        doc = ezdxf.readfile(dxf_path)
        msp = doc.modelspace()
    except Exception as e:
        logger.error(f"DXF 파일 읽기 실패: {e}")
        return []

    # 레이어별 엔티티 그룹화 (인접한 엔티티를 하나의 개구부로)
    door_bboxes = []
    window_bboxes = []

    for entity in msp:
        layer = entity.dxf.layer if hasattr(entity.dxf, 'layer') else ''

        bbox = _get_entity_bbox(entity)
        if bbox is None:
            continue

        if layer in door_layers:
            door_bboxes.append((bbox, layer))
        elif layer in window_layers:
            window_bboxes.append((bbox, layer))

    # 바운딩 박스 클러스터링 (인접한 것들 병합)
    door_openings = _cluster_bboxes(door_bboxes, 'door')
    window_openings = _cluster_bboxes(window_bboxes, 'window')

    openings.extend(door_openings)
    openings.extend(window_openings)

    logger.info(f"개구부 추출: 문 {len(door_openings)}개, 창문 {len(window_openings)}개")
    return openings


def _cluster_bboxes(
    bboxes: List[Tuple[Tuple[Tuple[float, float], Tuple[float, float]], str]],
    opening_type: str
) -> List[Opening]:
    """인접한 바운딩 박스를 클러스터링하여 개구부 생성.

    단순화: 각 바운딩 박스를 개별 개구부로 처리 (클러스터링 생략)
    실제로는 DBSCAN 등으로 그룹화할 수 있음
    """
    openings = []
    seen_centers = set()

    for (bbox_min, bbox_max), layer in bboxes:
        width = bbox_max[0] - bbox_min[0]
        height_2d = bbox_max[1] - bbox_min[1]  # 2D 높이 (실제 3D 높이 아님)

        # 너무 작은 것 필터링
        if width < 0.1 or height_2d < 0.1:
            continue

        center = (
            (bbox_min[0] + bbox_max[0]) / 2,
            (bbox_min[1] + bbox_max[1]) / 2
        )

        # 중복 방지 (근접한 중심점)
        center_key = (round(center[0], 1), round(center[1], 1))
        if center_key in seen_centers:
            continue
        seen_centers.add(center_key)

        # 기본 높이 설정
        if opening_type == 'door':
            default_height = DEFAULT_DOOR_HEIGHT
            bottom_z = 0.0
        else:
            default_height = DEFAULT_WINDOW_HEIGHT
            bottom_z = DEFAULT_WINDOW_BOTTOM_Z

        openings.append(Opening(
            center=center,
            width=max(width, 0.3),  # 최소 30cm
            height=default_height,
            bottom_z=bottom_z,
            opening_type=opening_type,
            layer=layer
        ))

    return openings


# ============= 벽면 매핑 =============

def _point_to_segment_distance(
    point: Tuple[float, float],
    seg_start: Tuple[float, float],
    seg_end: Tuple[float, float]
) -> Tuple[float, float]:
    """점에서 선분까지의 거리와 선분 상의 위치(0~1) 반환"""
    px, py = point
    x1, y1 = seg_start
    x2, y2 = seg_end

    dx = x2 - x1
    dy = y2 - y1
    length_sq = dx*dx + dy*dy

    if length_sq < 1e-10:
        # 선분이 점인 경우
        dist = np.sqrt((px - x1)**2 + (py - y1)**2)
        return dist, 0.0

    # 투영 위치 (0~1로 클램프)
    t = max(0, min(1, ((px - x1) * dx + (py - y1) * dy) / length_sq))

    # 투영점
    proj_x = x1 + t * dx
    proj_y = y1 + t * dy

    dist = np.sqrt((px - proj_x)**2 + (py - proj_y)**2)
    return dist, t


def map_openings_to_walls(
    openings: List[Opening],
    centerline_result: CenterlineResult,
    max_distance: float = MAX_MAPPING_DISTANCE
) -> List[MappedOpening]:
    """개구부를 가장 가까운 벽 세그먼트에 매핑.

    Args:
        openings: 개구부 목록
        centerline_result: centerline 재구성 결과
        max_distance: 최대 매핑 거리

    Returns:
        매핑된 개구부 목록
    """
    mapped = []

    for opening in openings:
        best_segment = None
        best_distance = float('inf')
        best_position = 0.0

        # 모든 벽 세그먼트에서 가장 가까운 것 찾기
        for segment in centerline_result.segments:
            dist, pos = _point_to_segment_distance(
                opening.center,
                segment.start,
                segment.end
            )

            if dist < best_distance:
                best_distance = dist
                best_segment = segment
                best_position = pos

        # 거리 임계값 체크
        if best_segment and best_distance <= max_distance:
            mapped.append(MappedOpening(
                opening=opening,
                wall_segment=best_segment,
                wall_position=best_position,
                distance=best_distance
            ))
        else:
            logger.debug(f"개구부 매핑 실패: center={opening.center}, 최소거리={best_distance:.2f}m")

    logger.info(f"개구부 매핑: {len(mapped)}/{len(openings)}개 성공")
    return mapped


# ============= 개구부 메쉬 생성 =============

def create_opening_quads(
    mapped_openings: List[MappedOpening],
    wall_height: float = 4.0
) -> List[Tuple[np.ndarray, str]]:
    """매핑된 개구부에서 색칠할 사각형(quad) 생성.

    각 개구부에 대해 벽면에 붙은 얇은 사각형 메쉬를 생성.
    실제 구멍을 뚫지 않고 색칠만 함 (Phase 3 = 텍스처 개구부).

    Args:
        mapped_openings: 매핑된 개구부 목록
        wall_height: 벽 높이

    Returns:
        [(vertices, opening_type), ...] 형태의 리스트
        vertices는 (4, 3) 형태의 사각형 정점
    """
    quads = []

    for mo in mapped_openings:
        opening = mo.opening
        segment = mo.wall_segment

        # 벽 방향 벡터
        wall_dir = np.array([
            segment.end[0] - segment.start[0],
            segment.end[1] - segment.start[1]
        ])
        wall_length = np.linalg.norm(wall_dir)
        if wall_length < 1e-10:
            continue
        wall_dir = wall_dir / wall_length

        # 벽 법선 (외부 방향)
        wall_normal = np.array([-wall_dir[1], wall_dir[0]])

        # 개구부 중심의 벽 위 위치
        center_on_wall = np.array([
            segment.start[0] + mo.wall_position * (segment.end[0] - segment.start[0]),
            segment.start[1] + mo.wall_position * (segment.end[1] - segment.start[1])
        ])

        # 개구부 반폭
        half_width = opening.width / 2

        # 개구부 높이 (Z축)
        bottom_z = opening.bottom_z
        top_z = bottom_z + (opening.height or (wall_height - bottom_z - 0.1))
        top_z = min(top_z, wall_height - 0.05)  # 천장 아래로 제한

        # 사각형 4개 정점 (벽 외부로 약간 돌출)
        offset = segment.thickness / 2 + 0.01  # 벽 표면에서 1cm 돌출

        p1 = np.array([
            center_on_wall[0] - half_width * wall_dir[0] + offset * wall_normal[0],
            center_on_wall[1] - half_width * wall_dir[1] + offset * wall_normal[1],
            bottom_z
        ])
        p2 = np.array([
            center_on_wall[0] + half_width * wall_dir[0] + offset * wall_normal[0],
            center_on_wall[1] + half_width * wall_dir[1] + offset * wall_normal[1],
            bottom_z
        ])
        p3 = np.array([
            center_on_wall[0] + half_width * wall_dir[0] + offset * wall_normal[0],
            center_on_wall[1] + half_width * wall_dir[1] + offset * wall_normal[1],
            top_z
        ])
        p4 = np.array([
            center_on_wall[0] - half_width * wall_dir[0] + offset * wall_normal[0],
            center_on_wall[1] - half_width * wall_dir[1] + offset * wall_normal[1],
            top_z
        ])

        vertices = np.array([p1, p2, p3, p4])
        quads.append((vertices, opening.opening_type))

    return quads
