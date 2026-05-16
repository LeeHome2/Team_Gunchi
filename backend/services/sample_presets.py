"""샘플 DXF 프리셋 정의.

사이드바에서 빠르게 테스트할 수 있는 샘플 도면 목록과
각 도면의 레이어 구성을 정의합니다.
"""

from typing import List, Dict, Any
from pathlib import Path

# 샘플 파일 디렉토리 (frontend/public/samples)
SAMPLES_DIR = Path(__file__).parent.parent.parent / "frontend" / "public" / "samples"


# 샘플 프리셋 정의
SAMPLE_PRESETS: List[Dict[str, Any]] = [
    {
        "id": "arquitectura",
        "name": "Arquitectura",
        "description": "스페인어 건축 도면 (대형)",
        "filename": "arquitectura.dxf",
        "thumbnail": None,  # 썸네일 이미지 경로 (옵션)
        "wall_layers": ["A-WALL", "A-WALL-FULL", "MUROS"],
        "door_layers": ["A-DOOR", "PUERTAS"],
        "window_layers": ["A-GLAZ", "A-WINDOW", "VENTANAS"],
        "height": 3.0,
        "tags": ["대형", "스페인어", "상세"],
    },
    {
        "id": "casa_velacion_1",
        "name": "Casa Velacion 1",
        "description": "장례식장 1층 평면도",
        "filename": "casa_velacion_1.dxf",
        "thumbnail": None,
        "wall_layers": ["MUROS", "A-WALL"],
        "door_layers": ["PUERTAS", "A-DOOR"],
        "window_layers": ["VENTANAS", "A-GLAZ"],
        "height": 3.0,
        "tags": ["중형", "스페인어"],
    },
    {
        "id": "casa_velacion_2",
        "name": "Casa Velacion 2",
        "description": "장례식장 2층 평면도",
        "filename": "casa_velacion_2.dxf",
        "thumbnail": None,
        "wall_layers": ["MUROS", "A-WALL"],
        "door_layers": ["PUERTAS", "A-DOOR"],
        "window_layers": ["VENTANAS", "A-GLAZ"],
        "height": 3.0,
        "tags": ["중형", "스페인어"],
    },
    {
        "id": "trabajo_final",
        "name": "Trabajo Final",
        "description": "최종 프로젝트 도면",
        "filename": "trabajo_final.dxf",
        "thumbnail": None,
        "wall_layers": ["MUROS", "PAREDES", "A-WALL"],
        "door_layers": ["PUERTAS", "A-DOOR"],
        "window_layers": ["VENTANAS", "A-WINDOW"],
        "height": 3.0,
        "tags": ["대형", "스페인어", "복잡"],
    },
]


def get_all_presets() -> List[Dict[str, Any]]:
    """모든 샘플 프리셋 목록 반환.

    파일 존재 여부를 확인하고, 존재하는 샘플만 반환합니다.
    """
    available = []
    for preset in SAMPLE_PRESETS:
        filepath = SAMPLES_DIR / preset["filename"]
        if filepath.exists():
            preset_copy = preset.copy()
            preset_copy["filepath"] = str(filepath)
            preset_copy["file_size_kb"] = round(filepath.stat().st_size / 1024, 1)
            available.append(preset_copy)
    return available


def get_preset_by_id(preset_id: str) -> Dict[str, Any] | None:
    """ID로 특정 프리셋 조회."""
    for preset in SAMPLE_PRESETS:
        if preset["id"] == preset_id:
            filepath = SAMPLES_DIR / preset["filename"]
            if filepath.exists():
                preset_copy = preset.copy()
                preset_copy["filepath"] = str(filepath)
                return preset_copy
    return None


def get_preset_filepath(preset_id: str) -> Path | None:
    """프리셋 ID로 파일 경로 반환."""
    preset = get_preset_by_id(preset_id)
    if preset:
        return Path(preset["filepath"])
    return None
