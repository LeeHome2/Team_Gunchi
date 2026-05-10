"""
BuildingManifest 데이터 모델.

전처리 결과를 building 단위로 정리하는 매니페스트.
Phase C 의 핵심 데이터 구조.
"""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from pydantic import BaseModel, Field


class Bounds(BaseModel):
    """좌표 범위 (bbox)."""
    min_x: float
    min_y: float
    max_x: float
    max_y: float


class Entrance(BaseModel):
    """메인 출입구 정보."""
    center: Tuple[float, float]    # DXF 좌표
    width: float                   # m
    wall_segment_id: Optional[str] = None  # 어느 외벽 segment 에 매핑됐는지
    dxf_layer: Optional[str] = None
    confidence: float = 1.0        # 휴리스틱 결과 신뢰도


class WindowFace(BaseModel):
    """주 창문 면 정보."""
    midpoint: Tuple[float, float]
    direction: Tuple[float, float]  # 정규화 벡터
    length: float
    window_count: int = 0
    total_window_width: float = 0.0
    confidence: float = 1.0


class Floor(BaseModel):
    """층별 정보."""
    floor_index: int               # 0=1층, -1=B1, etc.
    floor_label: str               # "1F", "B1", "RF"
    file_id: str                   # DXF 파일명 (확장자 제외)
    bounds: Optional[Bounds] = None  # 한 DXF 다중 평면도 시 자른 영역
    wall_layers: List[str] = Field(default_factory=list)
    door_layers: List[str] = Field(default_factory=list)
    window_layers: List[str] = Field(default_factory=list)
    main_entrance: Optional[Entrance] = None       # 1층에만
    primary_window_face: Optional[WindowFace] = None


class BuildingManifest(BaseModel):
    """건물 단위 매니페스트."""
    building_id: str
    name: Optional[str] = None
    source: str = "manual"          # "manual" | "auto"
    files: List[str] = Field(default_factory=list)  # DXF 파일명 목록
    floors: List[Floor] = Field(default_factory=list)
    coordinate_alignment: str = "bbox_centroid"  # "bbox_centroid" | "bbox_min" | "manual"
    align_offsets: Dict[int, Tuple[float, float]] = Field(default_factory=dict)  # floor_index → [dx, dy]
    created_at: str = ""
    updated_at: str = ""

    def model_post_init(self, __context) -> None:
        """생성/수정 시각 자동 설정."""
        now = datetime.utcnow().isoformat()
        if not self.created_at:
            self.created_at = now
        if not self.updated_at:
            self.updated_at = now


class ProcessStatus(BaseModel):
    """처리 상태 (관리자 UI 용)."""
    building_id: str
    state: str = "pending"          # "pending" | "running" | "completed" | "failed"
    current_step: str = ""          # "classify" | "detect_floorplan" | "openings" | "visualize" | ...
    progress_pct: int = 0
    error: Optional[str] = None
    started_at: Optional[str] = None
    completed_at: Optional[str] = None


def save_manifest(manifest: BuildingManifest, path: Path) -> None:
    """매니페스트 저장."""
    manifest.updated_at = datetime.utcnow().isoformat()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        manifest.model_dump_json(indent=2),
        encoding="utf-8"
    )


def load_manifest(path: Path) -> Optional[BuildingManifest]:
    """매니페스트 로드."""
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return BuildingManifest(**data)
    except Exception:
        return None


def save_status(status: ProcessStatus, path: Path) -> None:
    """상태 저장."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        status.model_dump_json(indent=2),
        encoding="utf-8"
    )


def load_status(path: Path) -> Optional[ProcessStatus]:
    """상태 로드."""
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return ProcessStatus(**data)
    except Exception:
        return None


def update_status(
    building_id: str,
    state: str,
    step: str,
    progress: int = 0,
    error: Optional[str] = None,
    *,
    processed_dir: Optional[Path] = None,
) -> ProcessStatus:
    """상태 업데이트 헬퍼."""
    if processed_dir is None:
        # 기본 경로
        processed_dir = Path(__file__).parent.parent.parent / "data" / "processed"

    status_path = processed_dir / building_id / "status.json"
    existing = load_status(status_path)

    now = datetime.utcnow().isoformat()

    if existing:
        status = existing
        status.state = state
        status.current_step = step
        status.progress_pct = progress
        if error:
            status.error = error
        if state == "running" and not status.started_at:
            status.started_at = now
        if state in ("completed", "failed"):
            status.completed_at = now
    else:
        status = ProcessStatus(
            building_id=building_id,
            state=state,
            current_step=step,
            progress_pct=progress,
            error=error,
            started_at=now if state == "running" else None,
            completed_at=now if state in ("completed", "failed") else None,
        )

    save_status(status, status_path)
    return status
