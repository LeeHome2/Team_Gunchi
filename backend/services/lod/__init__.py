"""
LOD2/3 매스 생성 모듈.

기존 LOD1 (gltf_exporter.create_wall_building_gltf) 와 별도로 동작.
벽 centerline 재구성 → 개구부 매핑 → 2D Shapely 구멍 뚫기 → 슬래브 추가.
실패 시 호출자 (main.py) 가 LOD1 으로 폴백한다.
"""

from typing import List, Tuple, Optional

# LOD enum
LOD1 = 1
LOD2 = 2
LOD3 = 3

# Phase 1: Centerline 재구성
from .wall_types import WallSegment, WallLoop, CenterlineResult
from .centerline import reconstruct_centerline

# Phase 2: LOD2 빌더
from .lod2_builder import build_lod2

# Phase 3: LOD2.5 (개구부 포함)
from .lod2_builder import build_lod2_with_openings
from .openings import Opening, MappedOpening, extract_openings, map_openings_to_walls

# Phase 4: LOD3 (실제 구멍 + 창틀/유리)
from .lod3_builder import build_lod3

# Phase 4 Simple: LOD3 Simple (LOD1 방식 + 문/창문 색상)
from .lod3_simple import build_lod3_simple

__all__ = [
    "LOD1", "LOD2", "LOD3",
    "WallSegment", "WallLoop", "CenterlineResult",
    "reconstruct_centerline",
    "build_lod2",
    "build_lod2_with_openings",
    "build_lod3",
    "build_lod3_simple",
    "Opening", "MappedOpening",
    "extract_openings", "map_openings_to_walls",
]
