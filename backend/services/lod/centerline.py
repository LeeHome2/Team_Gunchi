"""
벽 centerline 재구성 알고리즘.

DXF 엔티티(LINE, LWPOLYLINE)에서 centerline 모델로 정규화.
실패 시 빈 결과 반환 → 호출자가 LOD1 fallback 결정.
"""

import logging
from typing import List, Tuple, Optional, Dict, Any
import numpy as np
import ezdxf
from ezdxf.entities import Line, LWPolyline

from .wall_types import WallSegment, WallLoop, CenterlineResult

logger = logging.getLogger(__name__)


# ============= 상수 =============

# 평행선 매칭 임계값
PARALLEL_COS_THRESHOLD = 0.95  # cos(θ) > 0.95 → 약 18도 이내
MIN_WALL_THICKNESS = 0.05     # 최소 벽 두께 5cm
MAX_WALL_THICKNESS = 1.0      # 최대 벽 두께 1m
MIN_WALL_LENGTH = 0.1         # 최소 벽 길이 10cm

# LWPOLYLINE 처리
POLYLINE_CLOSE_THRESHOLD = 0.01  # 1cm 이내면 닫힌 폴리곤


# ============= LINE 평행선 매칭 =============

def _line_to_segment(line: Line) -> Tuple[Tuple[float, float], Tuple[float, float]]:
    """ezdxf LINE 엔티티를 (start, end) 튜플로 변환"""
    start = (line.dxf.start.x, line.dxf.start.y)
    end = (line.dxf.end.x, line.dxf.end.y)
    return start, end


def _segment_direction(start: Tuple[float, float], end: Tuple[float, float]) -> Tuple[float, float]:
    """세그먼트 방향 벡터 (정규화)"""
    dx = end[0] - start[0]
    dy = end[1] - start[1]
    length = np.sqrt(dx*dx + dy*dy)
    if length < 1e-10:
        return (1.0, 0.0)
    return (dx / length, dy / length)


def _segment_length(start: Tuple[float, float], end: Tuple[float, float]) -> float:
    """세그먼트 길이"""
    dx = end[0] - start[0]
    dy = end[1] - start[1]
    return np.sqrt(dx*dx + dy*dy)


def _point_to_line_distance(
    point: Tuple[float, float],
    line_start: Tuple[float, float],
    line_end: Tuple[float, float]
) -> float:
    """점에서 선분까지의 수직 거리"""
    # 선분 벡터
    dx = line_end[0] - line_start[0]
    dy = line_end[1] - line_start[1]
    length_sq = dx*dx + dy*dy

    if length_sq < 1e-10:
        # 선분이 점인 경우
        return np.sqrt((point[0] - line_start[0])**2 + (point[1] - line_start[1])**2)

    # 점을 선분에 투영
    t = max(0, min(1, ((point[0] - line_start[0]) * dx + (point[1] - line_start[1]) * dy) / length_sq))
    proj_x = line_start[0] + t * dx
    proj_y = line_start[1] + t * dy

    return np.sqrt((point[0] - proj_x)**2 + (point[1] - proj_y)**2)


def _are_parallel(dir1: Tuple[float, float], dir2: Tuple[float, float]) -> bool:
    """두 방향 벡터가 평행한지 (반대 방향 포함)"""
    cos_angle = abs(dir1[0] * dir2[0] + dir1[1] * dir2[1])
    return cos_angle > PARALLEL_COS_THRESHOLD


def _lines_overlap_range(
    start1: Tuple[float, float], end1: Tuple[float, float],
    start2: Tuple[float, float], end2: Tuple[float, float],
    direction: Tuple[float, float]
) -> float:
    """두 평행선의 투영 겹침 비율 (0.0~1.0)"""
    # 방향 벡터에 투영
    def project(p):
        return p[0] * direction[0] + p[1] * direction[1]

    proj1_start = project(start1)
    proj1_end = project(end1)
    proj2_start = project(start2)
    proj2_end = project(end2)

    # 정렬
    min1, max1 = min(proj1_start, proj1_end), max(proj1_start, proj1_end)
    min2, max2 = min(proj2_start, proj2_end), max(proj2_start, proj2_end)

    # 겹침 구간
    overlap_start = max(min1, min2)
    overlap_end = min(max1, max2)

    if overlap_end <= overlap_start:
        return 0.0

    overlap_length = overlap_end - overlap_start
    shorter_length = min(max1 - min1, max2 - min2)

    if shorter_length < 1e-10:
        return 0.0

    return overlap_length / shorter_length


def match_parallel_lines(
    lines: List[Line],
    default_thickness: float = 0.15
) -> Tuple[List[WallSegment], List[int]]:
    """평행선 쌍을 매칭하여 WallSegment로 변환.

    Args:
        lines: ezdxf LINE 엔티티 목록
        default_thickness: 단일 LINE일 때 기본 두께

    Returns:
        (매칭된 WallSegment 목록, 사용된 LINE 인덱스 목록)
    """
    if not lines:
        return [], []

    segments = []
    used_indices = set()
    n = len(lines)

    # 모든 LINE의 정보 미리 계산
    line_info = []
    for i, line in enumerate(lines):
        start, end = _line_to_segment(line)
        direction = _segment_direction(start, end)
        length = _segment_length(start, end)
        midpoint = ((start[0] + end[0]) / 2, (start[1] + end[1]) / 2)
        layer = line.dxf.layer if hasattr(line.dxf, 'layer') else None
        line_info.append({
            'index': i,
            'start': start,
            'end': end,
            'direction': direction,
            'length': length,
            'midpoint': midpoint,
            'layer': layer
        })

    # 평행선 쌍 매칭
    for i in range(n):
        if i in used_indices:
            continue

        info_i = line_info[i]
        if info_i['length'] < MIN_WALL_LENGTH:
            continue

        best_match = None
        best_distance = float('inf')

        for j in range(i + 1, n):
            if j in used_indices:
                continue

            info_j = line_info[j]
            if info_j['length'] < MIN_WALL_LENGTH:
                continue

            # 평행 체크
            if not _are_parallel(info_i['direction'], info_j['direction']):
                continue

            # 수직 거리 계산 (중점 사용)
            dist = _point_to_line_distance(info_j['midpoint'], info_i['start'], info_i['end'])

            # 벽 두께 범위 체크
            if dist < MIN_WALL_THICKNESS or dist > MAX_WALL_THICKNESS:
                continue

            # 투영 겹침 체크 (50% 이상 겹쳐야 함)
            overlap = _lines_overlap_range(
                info_i['start'], info_i['end'],
                info_j['start'], info_j['end'],
                info_i['direction']
            )
            if overlap < 0.5:
                continue

            if dist < best_distance:
                best_distance = dist
                best_match = j

        if best_match is not None:
            # 매칭 성공 → centerline 생성
            info_j = line_info[best_match]

            # centerline = 두 선분의 중점 연결
            center_start = (
                (info_i['start'][0] + info_j['start'][0]) / 2,
                (info_i['start'][1] + info_j['start'][1]) / 2
            )
            center_end = (
                (info_i['end'][0] + info_j['end'][0]) / 2,
                (info_i['end'][1] + info_j['end'][1]) / 2
            )

            # 방향이 반대면 조정
            dir_i = info_i['direction']
            dir_j = info_j['direction']
            if dir_i[0] * dir_j[0] + dir_i[1] * dir_j[1] < 0:
                # j의 방향이 반대
                center_start = (
                    (info_i['start'][0] + info_j['end'][0]) / 2,
                    (info_i['start'][1] + info_j['end'][1]) / 2
                )
                center_end = (
                    (info_i['end'][0] + info_j['start'][0]) / 2,
                    (info_i['end'][1] + info_j['start'][1]) / 2
                )

            segments.append(WallSegment(
                start=center_start,
                end=center_end,
                thickness=best_distance,
                layer=info_i['layer']
            ))
            used_indices.add(i)
            used_indices.add(best_match)

    # 매칭되지 않은 단일 LINE → 기본 두께로 처리
    for i in range(n):
        if i in used_indices:
            continue
        info = line_info[i]
        if info['length'] < MIN_WALL_LENGTH:
            continue

        segments.append(WallSegment(
            start=info['start'],
            end=info['end'],
            thickness=default_thickness,
            layer=info['layer']
        ))
        used_indices.add(i)

    return segments, list(used_indices)


# ============= LWPOLYLINE 처리 =============

def process_lwpolyline(
    polyline: LWPolyline,
    default_thickness: float = 0.15
) -> Tuple[Optional[WallLoop], List[WallSegment]]:
    """LWPOLYLINE을 WallLoop 또는 WallSegment 목록으로 변환.

    닫힌 폴리라인 → WallLoop (외곽선)
    열린 폴리라인 → WallSegment 목록 (각 세그먼트별)

    Args:
        polyline: ezdxf LWPOLYLINE 엔티티
        default_thickness: 기본 두께

    Returns:
        (WallLoop 또는 None, WallSegment 목록)
    """
    try:
        # 정점 추출
        points = [(p[0], p[1]) for p in polyline.get_points('xy')]
        if len(points) < 2:
            return None, []

        layer = polyline.dxf.layer if hasattr(polyline.dxf, 'layer') else None

        # 닫힌 폴리라인인지 확인
        is_closed = polyline.closed
        if not is_closed:
            # 시작점과 끝점이 가까우면 닫힌 것으로 처리
            first, last = points[0], points[-1]
            dist = np.sqrt((first[0] - last[0])**2 + (first[1] - last[1])**2)
            is_closed = dist < POLYLINE_CLOSE_THRESHOLD

        if is_closed:
            # 닫힌 폴리라인 → WallLoop
            return WallLoop(
                points=points,
                thickness=default_thickness,
                layer=layer
            ), []
        else:
            # 열린 폴리라인 → WallSegment 목록
            segments = []
            for i in range(len(points) - 1):
                start = points[i]
                end = points[i + 1]
                length = _segment_length(start, end)
                if length >= MIN_WALL_LENGTH:
                    segments.append(WallSegment(
                        start=start,
                        end=end,
                        thickness=default_thickness,
                        layer=layer
                    ))
            return None, segments

    except Exception as e:
        logger.warning(f"LWPOLYLINE 처리 실패: {e}")
        return None, []


# ============= 통합 함수 =============

def reconstruct_centerline(
    dxf_path: str,
    wall_layers: List[str],
    default_thickness: float = 0.15
) -> CenterlineResult:
    """DXF 파일에서 벽 centerline 모델 추출.

    Args:
        dxf_path: DXF 파일 경로
        wall_layers: 벽 레이어 이름 목록
        default_thickness: 기본 벽 두께 (m)

    Returns:
        CenterlineResult (성공률 80% 미만이면 LOD1 폴백 권장)
    """
    warnings = []
    all_segments: List[WallSegment] = []
    all_loops: List[WallLoop] = []
    total_entities = 0
    processed_entities = 0

    try:
        doc = ezdxf.readfile(dxf_path)
        msp = doc.modelspace()
    except Exception as e:
        logger.error(f"DXF 파일 읽기 실패: {e}")
        return CenterlineResult(
            segments=[],
            loops=[],
            success_rate=0.0,
            failed_entities=0,
            warnings=[f"DXF 파일 읽기 실패: {e}"]
        )

    # 레이어별 엔티티 수집
    lines: List[Line] = []
    polylines: List[LWPolyline] = []

    for entity in msp:
        layer = entity.dxf.layer if hasattr(entity.dxf, 'layer') else ''
        if layer not in wall_layers:
            continue

        total_entities += 1
        entity_type = entity.dxftype()

        if entity_type == 'LINE':
            lines.append(entity)
        elif entity_type == 'LWPOLYLINE':
            polylines.append(entity)
        else:
            # 지원하지 않는 엔티티 타입
            warnings.append(f"지원하지 않는 엔티티 타입: {entity_type} (레이어: {layer})")

    logger.info(f"벽 엔티티 수집: LINE {len(lines)}개, LWPOLYLINE {len(polylines)}개")

    # LINE 평행선 매칭
    if lines:
        segments, used_indices = match_parallel_lines(lines, default_thickness)
        all_segments.extend(segments)
        processed_entities += len(used_indices)
        logger.info(f"LINE 매칭 결과: {len(segments)}개 세그먼트 (사용된 LINE: {len(used_indices)}개)")

    # LWPOLYLINE 처리
    for polyline in polylines:
        loop, segments = process_lwpolyline(polyline, default_thickness)
        if loop:
            all_loops.append(loop)
            processed_entities += 1
        if segments:
            all_segments.extend(segments)
            processed_entities += 1

    logger.info(f"LWPOLYLINE 처리 결과: {len(all_loops)}개 루프, {len(all_segments) - len(lines)}개 세그먼트 추가")

    # 성공률 계산
    success_rate = processed_entities / total_entities if total_entities > 0 else 0.0
    failed_entities = total_entities - processed_entities

    result = CenterlineResult(
        segments=all_segments,
        loops=all_loops,
        success_rate=success_rate,
        failed_entities=failed_entities,
        warnings=warnings
    )

    logger.info(f"Centerline 재구성 완료: 성공률 {success_rate:.1%}, "
                f"세그먼트 {len(all_segments)}개, 루프 {len(all_loops)}개")

    return result
