"""
벽 centerline 모델 데이터 타입 정의.

LOD2/3 매스 생성을 위한 정규화된 벽 표현.
입력이 LINE 두 겹이든, LWPOLYLINE이든 동일한 내부 표현으로 변환.
"""

from dataclasses import dataclass
from typing import Tuple, List, Optional
import numpy as np


@dataclass
class WallSegment:
    """단일 벽 세그먼트 (centerline 기반).

    Attributes:
        start: 시작점 (x, y)
        end: 끝점 (x, y)
        thickness: 벽 두께 (m)
        height: 벽 높이 (m), None이면 기본값 사용
        layer: 원본 DXF 레이어명
    """
    start: Tuple[float, float]
    end: Tuple[float, float]
    thickness: float
    height: Optional[float] = None
    layer: Optional[str] = None

    @property
    def length(self) -> float:
        """벽 세그먼트 길이"""
        dx = self.end[0] - self.start[0]
        dy = self.end[1] - self.start[1]
        return np.sqrt(dx*dx + dy*dy)

    @property
    def direction(self) -> Tuple[float, float]:
        """정규화된 방향 벡터"""
        dx = self.end[0] - self.start[0]
        dy = self.end[1] - self.start[1]
        length = self.length
        if length < 1e-10:
            return (1.0, 0.0)
        return (dx / length, dy / length)

    @property
    def midpoint(self) -> Tuple[float, float]:
        """중점"""
        return (
            (self.start[0] + self.end[0]) / 2,
            (self.start[1] + self.end[1]) / 2
        )


@dataclass
class WallLoop:
    """닫힌 벽 루프 (LWPOLYLINE 등에서 추출).

    외벽 윤곽선을 표현. centerline이 아닌 외곽선 기반.
    """
    points: List[Tuple[float, float]]  # 닫힌 폴리곤 정점들
    thickness: float  # 내부 offset으로 처리할 두께
    layer: Optional[str] = None

    @property
    def is_closed(self) -> bool:
        """폴리곤이 닫혀있는지"""
        if len(self.points) < 3:
            return False
        first = self.points[0]
        last = self.points[-1]
        dist = np.sqrt((first[0]-last[0])**2 + (first[1]-last[1])**2)
        return dist < 0.01  # 1cm 이내면 닫힘


@dataclass
class CenterlineResult:
    """centerline 재구성 결과.

    Attributes:
        segments: 추출된 벽 세그먼트 목록
        loops: 닫힌 벽 루프 목록 (LWPOLYLINE에서)
        success_rate: 성공적으로 변환된 엔티티 비율 (0.0~1.0)
        failed_entities: 변환 실패한 엔티티 수
        warnings: 경고 메시지 목록
    """
    segments: List[WallSegment]
    loops: List[WallLoop]
    success_rate: float
    failed_entities: int
    warnings: List[str]

    @property
    def total_segments(self) -> int:
        return len(self.segments)

    @property
    def total_loops(self) -> int:
        return len(self.loops)

    @property
    def is_usable(self) -> bool:
        """LOD2 생성에 사용 가능한지 (80% 이상 성공)"""
        return self.success_rate >= 0.8
