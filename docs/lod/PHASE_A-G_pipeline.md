# Phase A-G: 전처리 파이프라인 + 다층 매스 + 출입구 검출

> **Claude Code 가 이 문서부터 읽고 시작.** 호민님과 Cowork 세션에서 결정 완료된 사항을 기반으로 작성. 결정 재논의 금지.
> 작성: 2026-04-29 (Cowork 세션)
> 선행 문서: `README.md`, `HANDOFF.md`, `CLAUDE.md`, `STATUS.md`

---

## 0. 1분 요약

- AWS EC2 의 `data/raw/` 의 DXF (현재 ~200개, 향후 ~2000개) 를 학과 vLLM + 휴리스틱으로 자동 전처리
- 결과를 **building 단위 매니페스트** 로 정리하고, 각 단계를 **PNG 로 시각화** 해서 관리자가 검수 가능
- 매니페스트를 보고 **다층 매스 합성** + 메인 출입구 / 주 창문 면 마커
- 작업 분담: 크롤러는 팀원, AWS 측 파이프라인은 호민님 + 신재훈

---

## 1. 결정사항 (Cowork 세션에서 합의 완료, 재논의 금지)

| 항목 | 결정 |
|---|---|
| ① 데이터 출처 | EC2 의 `data/raw/` 200개로 시작. 팀원 크롤러는 이후 합류 (별도 폴더로 들어옴) |
| ② 자동화 수준 | cron 자동 실행 + **각 Phase 마다 검수용 PNG 자동 생성** (호민님 핵심 요구) |
| ③ 저장 | EC2 로컬 디스크. S3 안 씀 (~2000개까지 충분) |
| ④ 새 라벨 학습 방식 | **휴리스틱 우선** — 학습 모델 추가는 v1.1 이후 |
| ⑤ 시연 우선순위 | 데모 임팩트 (사용자 도면 업로드 → 즉시 다층 매스 + 출입구/창문 마커) |

---

## 2. 전체 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│ AWS EC2 (사용자 서비스 + 전처리)                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  data/raw/                                                  │
│  ├── manual/             ← 호민님 수동 업로드               │
│  │   ├── house_a/                                           │
│  │   │   ├── 1F.dxf                                         │
│  │   │   └── 2F.dxf                                         │
│  │   └── arquitectura/                                      │
│  │       └── arquitectura.dxf  (다중 평면도 한 파일)        │
│  └── auto/               ← 팀원 크롤러 결과 (이후)          │
│      └── 2026-05-XX/                                        │
│          └── seoul_apt_001/                                 │
│              ├── 1F.dxf                                     │
│              └── 2F.dxf                                     │
│                                                             │
│  ▼ preprocess_building()  (Phase C)                         │
│                                                             │
│  data/processed/{building_id}/                              │
│  ├── original.png             # 원본 도면 (이미 있는 코드)  │
│  ├── overlay.png              # 4색 합성 (벽/문/창/기타)    │
│  ├── floorplans_marked.png    # 평면도 bbox 빨간 박스       │
│  ├── openings_marked.png      # 메인 출입구●, 주 창문면▬   │
│  ├── layers/                                                │
│  │   ├── wall.png             # 벽만 (검정)                 │
│  │   ├── door.png             # 문만 (주황)                 │
│  │   └── window.png           # 창문만 (하늘)               │
│  ├── manifest.json            # BuildingManifest            │
│  └── status.json              # 처리 상태 (관리자 UI 용)    │
│                                                             │
│  ▼ /api/generate-mass-multi  (Phase F)                      │
│                                                             │
│  manifest lookup → build_multi_floor_mass(...) → GLB        │
│  + main_entrance/primary_window_face 메타데이터              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ POST /api/mlops/datasets/upload
                            ▼ (학습 시점에만)
┌─────────────────────────────────────────────────────────────┐
│ 학과 AI 서버 (학습 + 추론)                                   │
│  • /api/classify — 기존                                     │
│  • /api/detect-floorplan ★ 신규 (Phase A)                   │
│  • /api/mlops/train, /deploy — 기존                         │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Phase A — 학과 AI 서버 detect-floorplan API 노출

**위치**: `ai_layer_classifier/main.py`
**예상 시간**: 1~2시간
**의존**: 없음 (다른 Phase 시작 전 우선)

### 작업

`dataset/detect_floorplan.py:detect_floorplan_for_file()` 함수가 이미 존재. FastAPI 엔드포인트로 wrap.

```python
@app.post("/api/detect-floorplan")
async def detect_floorplan_endpoint(
    file: UploadFile = File(...),
    mock: bool = Form(False),
):
    """
    DXF 파일 → vLLM Vision 평면도 bbox 검출.

    응답:
      {
        "floorplans_found": true,
        "floorplans": [
          {
            "label": "1F",        # vLLM 추론 (1F/2F/B1/RF 등)
            "floor_index": 0,     # 0-based (LLM 추론, 실패 시 -1)
            "reason": "...",
            "bbox": {"x_min": 0.05, "y_min": 0.10, "x_max": 0.45, "y_max": 0.50}
          },
          ...
        ],
        "extent_dxf": {"min_x": ..., "min_y": ..., "max_x": ..., "max_y": ...}
        # DXF 의 실제 좌표 범위 — 정규화 bbox → DXF 좌표 환산용
      }
    """
    import tempfile, shutil, ezdxf
    from pathlib import Path
    from dataset.render_preview import render_dxf_to_png
    from dataset.detect_floorplan import detect_floorplan_for_file
    from config import BASE_DIR
    
    # 1. 업로드 임시 저장
    with tempfile.NamedTemporaryFile(suffix=".dxf", delete=False) as tmp:
        shutil.copyfileobj(file.file, tmp)
        dxf_path = Path(tmp.name)

    try:
        # 2. PNG 렌더 (캐시 디렉토리)
        render_dir = BASE_DIR / "data" / "preview"
        render_dir.mkdir(parents=True, exist_ok=True)
        meta = render_dxf_to_png(dxf_path, render_dir)
        png_path = Path(meta["png_path"])

        # 3. vLLM 검출
        result = detect_floorplan_for_file(
            png_path=png_path,
            cache_dir=BASE_DIR / "data" / "processed",
            mock=mock,
            use_cache=True,
        )

        # 4. DXF extent (정규화 → DXF 환산용)
        if meta.get("extents_cad"):
            result["extent_dxf"] = meta["extents_cad"]
        else:
            result["extent_dxf"] = _compute_dxf_extent(dxf_path)

        return result
    finally:
        try:
            dxf_path.unlink(missing_ok=True)
        except Exception:
            pass


def _compute_dxf_extent(dxf_path: Path) -> dict:
    import ezdxf
    doc = ezdxf.readfile(str(dxf_path))
    msp = doc.modelspace()
    xs, ys = [], []
    for ent in msp:
        et = ent.dxftype()
        if et == "LINE":
            xs.extend([ent.dxf.start[0], ent.dxf.end[0]])
            ys.extend([ent.dxf.start[1], ent.dxf.end[1]])
        elif et == "LWPOLYLINE":
            for p in ent.get_points():
                xs.append(p[0]); ys.append(p[1])
    if not xs:
        return {"min_x": 0, "min_y": 0, "max_x": 0, "max_y": 0}
    return {"min_x": min(xs), "min_y": min(ys),
            "max_x": max(xs), "max_y": max(ys)}
```

### 프롬프트 확장 — `floor_label` 추가

`ai_layer_classifier/configs/llm_prompts/floorplan_bbox_prompt.txt` 끝부분에 추가:

```
추가 작업:
- 각 평면도가 몇 층인지 추론하여 "label" 필드에 답하라.
  • "B1" "B2" — 지하층 (basement)
  • "1F" "2F" "3F" ... — 지상층
  • "RF" — 옥상/지붕층 (roof)
- 추론 단서: 도면 내 "1층", "2F", "지하1층" 같은 한글/영문 라벨, 평면도 위치
  (보통 책상에 펼친 도면처럼 1층이 좌하단/하단, 위층이 위쪽)
- 추론 어려우면 "label" 을 "floorplan_N" 으로 표시 (N = 0부터)

출력 형식 변경 — 각 floorplan 에 floor_index 필드 추가:
{
  "floorplans": [
    {
      "label": "1F",
      "floor_index": 0,    ← 0-based, 추론 실패 시 -1
      "reason": "...",
      "bbox": {...}
    }
  ]
}
```

### parse_response 확장

`ai_layer_classifier/llm/parse_response.py:_validate_single_bbox` 호출하는 곳에서 floor_index 파싱:

```python
items.append({
    "label": str(fp.get("label", f"floorplan_{idx}")),
    "floor_index": int(fp.get("floor_index", -1)) if fp.get("floor_index") is not None else -1,
    "reason": str(fp.get("reason", "")),
    "bbox": _validate_single_bbox(fp["bbox"]),
})
```

### DoD

- [ ] `POST /api/detect-floorplan` 엔드포인트 등록 (openapi.json 에 보임)
- [ ] arquitectura.dxf 로 호출 → 다중 평면도 + floor_label 반환
- [ ] mock 모드 동작 (vLLM 호출 없이 fake 응답)
- [ ] AWS 백엔드에서 호출 가능 (CORS 설정 — 이미 `allow_origins=["*"]` )

### 배포

```bash
scp ai_layer_classifier/main.py ai_layer_classifier/llm/parse_response.py \
    ai_layer_classifier/configs/llm_prompts/floorplan_bbox_prompt.txt \
    t26206@ceprj2.gachon.ac.kr:~/Team_Gunchi_classifier/...
ssh t26206@ceprj2.gachon.ac.kr
cd ~/Team_Gunchi_classifier
pkill -f "python3 -m main"; sleep 2
nohup python3 -m main > server.log 2>&1 &; disown
curl -s http://localhost:65006/openapi.json | python3 -c "import sys,json;d=json.load(sys.stdin);print('\n'.join(p for p in d['paths'] if 'detect' in p))"
# 출력: /api/detect-floorplan
```

---

## 4. Phase B — Visualizer 모듈 (호민님 핵심 요구)

**위치**: `building_cesium/backend/services/preprocess/visualizer.py` (신규)
**예상 시간**: 3~4시간
**의존**: Phase A

매 단계의 결과물을 **PNG 로 시각화** 해서 호민님이 관리자 화면에서 검수 가능하도록.

### 디렉토리 구조

```
backend/services/preprocess/
├── __init__.py
├── visualizer.py        ← Phase B
├── manifest.py          ← Phase C
├── pipeline.py          ← Phase C
├── clusterer.py         ← Phase C
├── openings.py          ← Phase C (휴리스틱)
└── scheduler.py         ← Phase D
```

### visualizer.py 함수 시그니처

```python
"""
DXF 처리 단계별 시각화 PNG 생성.
관리자 화면 (/admin/ai) 의 갤러리에서 사용.
"""
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle, Circle
from pathlib import Path
from typing import List, Dict, Optional, Tuple

import ezdxf
from ezdxf.addons.drawing import Frontend, RenderContext
from ezdxf.addons.drawing.matplotlib import MatplotlibBackend
from ezdxf.addons.drawing.config import ColorPolicy, Configuration


# ─── 색상 상수 ─────────────────────────────────────
COLOR_WALL = "#1a1a1a"      # 검정
COLOR_DOOR = "#ff8c00"      # 주황
COLOR_WINDOW = "#00b4ff"    # 하늘
COLOR_OTHER = "#aaaaaa"     # 회색
COLOR_BBOX = "#ff0000"      # 빨강 (평면도 박스)
COLOR_MAIN_ENTRANCE = "#ff0000"  # 빨강 (메인 출입구)
COLOR_PRIMARY_WINDOW = "#ffd700"  # 금색 (주 창문면)


def render_layer_overlay(
    dxf_path: Path,
    target_layers: List[str],
    color: str,
    output_path: Path,
    *,
    figsize: Tuple[int, int] = (12, 12),
    dpi: int = 100,
    other_alpha: float = 0.15,
) -> Path:
    """특정 레이어만 색칠. 나머지는 회색 옅게.
    
    벽만/문만/창문만 각각 한 번씩 호출."""
    # ezdxf 로 doc 로드 → HATCH 제거
    # target_layers 외 엔티티는 alpha 낮춤
    # target_layers 엔티티는 color 로 렌더
    ...


def render_overlay_4color(
    dxf_path: Path,
    layer_decisions: Dict[str, str],  # {layer_name: "wall"|"door"|"window"|"other"}
    output_path: Path,
    *,
    figsize: Tuple[int, int] = (12, 12),
    dpi: int = 100,
) -> Path:
    """벽/문/창/other 4색 합성 — AI 분류 검증용."""
    ...


def render_floorplans_marked(
    dxf_path: Path,
    floorplans: List[Dict],   # detect_floorplan 응답의 floorplans
    extent_dxf: Dict[str, float],
    output_path: Path,
) -> Path:
    """원본 위에 평면도 bbox 빨간 박스 + label 오버레이."""
    # 정규화 좌표 → DXF 좌표 환산 (y 축 뒤집기 주의)
    ...


def render_openings_marked(
    dxf_path: Path,
    main_entrance: Optional[Dict],   # {"center": [x,y], "width": ...}
    primary_window_face: Optional[Dict],  # {"midpoint": [x,y], "direction": [dx,dy], "length": ...}
    output_path: Path,
) -> Path:
    """원본 위에 메인 출입구 ● + 주 창문면 ▬ 마커."""
    ...


def render_thumbnail(
    dxf_path: Path,
    output_path: Path,
    *,
    size: int = 200,
) -> Path:
    """관리자 갤러리 썸네일용 작은 PNG (200×200)."""
    ...


# ─── 내부 헬퍼 ─────────────────────────────────────

def _load_doc_clean(dxf_path: Path):
    """DXF 로드 + HATCH/SOLID 메모리 제거 (render_preview.py 와 동일)."""
    doc = ezdxf.readfile(str(dxf_path))
    msp = doc.modelspace()
    for e in list(msp):
        if e.dxftype() in ("HATCH", "SOLID"):
            msp.delete_entity(e)
    return doc


def _normalized_to_dxf(
    bbox_norm: Dict[str, float],
    extent: Dict[str, float],
) -> Dict[str, float]:
    """정규화 bbox (PNG 좌표 0~1) → DXF 좌표.
    PNG 는 y 가 위→아래 증가, DXF 는 아래→위 증가 → y 뒤집기."""
    w = extent["max_x"] - extent["min_x"]
    h = extent["max_y"] - extent["min_y"]
    return {
        "min_x": extent["min_x"] + bbox_norm["x_min"] * w,
        "max_x": extent["min_x"] + bbox_norm["x_max"] * w,
        "min_y": extent["min_y"] + (1 - bbox_norm["y_max"]) * h,
        "max_y": extent["min_y"] + (1 - bbox_norm["y_min"]) * h,
    }
```

### DoD

- [ ] 5종 PNG 함수 모두 동작 (wall/door/window 단독 + overlay 4색 + floorplans + openings)
- [ ] arquitectura.dxf 로 5종 모두 생성 → 시각적으로 검수 가능
- [ ] PNG 사이즈 합 < 5MB (관리자 갤러리 로드 부담 방지)

### 단위 테스트

`backend/services/preprocess/test_visualizer.py`:
```python
def test_render_overlay_4color(tmp_path):
    # 합성 DXF 생성 (벽/문/창 레이어 각각)
    dxf = create_test_dxf(...)
    layer_decisions = {"WALL": "wall", "DOOR_M01": "door", "WINDOW": "window"}
    out = render_overlay_4color(dxf, layer_decisions, tmp_path / "overlay.png")
    assert out.exists()
    assert out.stat().st_size > 1000  # 최소 1KB
```

---

## 5. Phase C — 전처리 파이프라인

**위치**: `building_cesium/backend/services/preprocess/`
**예상 시간**: 5~6시간
**의존**: Phase A, B

### 데이터 모델 (`manifest.py`)

```python
from pydantic import BaseModel
from typing import List, Dict, Optional, Tuple

class Bounds(BaseModel):
    min_x: float
    min_y: float
    max_x: float
    max_y: float

class Entrance(BaseModel):
    center: Tuple[float, float]    # DXF 좌표
    width: float                    # m
    wall_segment_id: Optional[str]  # 어느 외벽 segment 에 매핑됐는지
    dxf_layer: Optional[str]
    confidence: float = 1.0         # 휴리스틱 결과 신뢰도

class WindowFace(BaseModel):
    midpoint: Tuple[float, float]
    direction: Tuple[float, float]  # 정규화 벡터
    length: float
    window_count: int
    total_window_width: float
    confidence: float = 1.0

class Floor(BaseModel):
    floor_index: int               # 0=1층
    floor_label: str               # "1F", "B1", "RF"
    file_id: str                   # DXF 파일명 (확장자 제외)
    bounds: Optional[Bounds] = None  # 한 DXF 다중 평면도 시 자른 영역
    wall_layers: List[str]
    door_layers: List[str]
    window_layers: List[str]
    main_entrance: Optional[Entrance] = None       # 1층에만
    primary_window_face: Optional[WindowFace] = None

class BuildingManifest(BaseModel):
    building_id: str
    name: Optional[str] = None
    source: str = "manual"          # "manual" | "auto"
    files: List[str]                # DXF 파일명 목록
    floors: List[Floor]
    coordinate_alignment: str = "bbox_centroid"  # "bbox_centroid" | "bbox_min" | "manual"
    align_offsets: Dict[int, Tuple[float, float]] = {}  # floor_index → [dx, dy]
    created_at: str
    updated_at: str

class ProcessStatus(BaseModel):
    building_id: str
    state: str                     # "pending" | "running" | "completed" | "failed"
    current_step: str = ""         # "classify" | "detect_floorplan" | "openings" | "visualize" | ...
    progress_pct: int = 0
    error: Optional[str] = None
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
```

저장 위치:
- `data/processed/{building_id}/manifest.json`
- `data/processed/{building_id}/status.json`

### Building Cluster (`clusterer.py`)

같은 건물 묶기:

```python
import re
from pathlib import Path
from collections import defaultdict
from typing import List, Dict

# 층 라벨 패턴
FLOOR_SUFFIX_PATTERNS = [
    r'[_\s\-]?B?\d+F?L?$',     # _1F, _B1, _2F, _F1
    r'[_\s\-]?지하?\d*층?$',    # _지1층, _지하1
    r'[_\s\-]?\d+층?$',         # _1층, _2
    r'[_\s\-]?(RF|roof|옥상|지붕)$',
]

def cluster_buildings(raw_dir: Path) -> Dict[str, List[Path]]:
    """raw_dir 의 모든 DXF 를 building_id 별로 그룹.
    
    1차: 폴더 = 건물 (raw_dir/{building_id}/*.dxf)
    2차: 단일 파일이면 stem 의 prefix 휴리스틱
    """
    groups = defaultdict(list)
    
    # 1차: 폴더 그룹
    for folder in raw_dir.iterdir():
        if not folder.is_dir():
            continue
        dxfs = list(folder.glob("*.dxf"))
        if dxfs:
            groups[folder.name].extend(dxfs)
    
    # 2차: raw_dir 직속 DXF — 파일명 prefix 추출
    for dxf in raw_dir.glob("*.dxf"):
        stem = dxf.stem
        for pat in FLOOR_SUFFIX_PATTERNS:
            stem = re.sub(pat, '', stem, flags=re.I)
        # stem 이 비면 단일 파일 = 단일 건물
        building_id = stem if stem else dxf.stem
        groups[building_id].append(dxf)
    
    return dict(groups)
```

### 출입구/창문 휴리스틱 (`openings.py`)

```python
"""
도면에서 메인 출입구 + 주 창문 면 추출 (휴리스틱).

학습 모델 안 씀. 규칙:
1. 외벽 = wall centerline 의 outer perimeter
2. 메인 출입구 = 외벽에 붙은 문 중 가장 큰 것 (폭 최대)
3. 주 창문 면 = 외벽 segment 마다 붙은 창문 폭 합 → 합 최대인 segment
"""
from typing import List, Optional, Dict
from dataclasses import dataclass
import numpy as np
from shapely.geometry import LineString, Polygon, Point
from shapely.ops import unary_union

# Phase 1 산출물 활용
from services.lod.wall_types import WallSegment, CenterlineResult
# LOD3 의 door/window 추출 함수 재사용
from services.lod.lod3_simple import _extract_doors_from_layer, _extract_windows_from_layer


def find_main_entrance(
    doors: List[tuple],          # [(cx, cy, width, height, panel_angle), ...]
    walls: List[WallSegment],
    site_footprint: Optional[List] = None,  # 대지 footprint (외벽 판별 보조)
) -> Optional[Dict]:
    """
    1. 외벽만 추리기 (wall list 의 outer perimeter)
    2. 외벽 0.5m 이내에 붙은 문 후보
    3. 후보 중 width 최대 = 메인 출입구
    
    return None 이면 적절한 메인 출입구 없음 (warning)
    """
    if not doors or not walls:
        return None
    
    outer_walls = _compute_outer_walls(walls)
    if not outer_walls:
        return None
    
    candidates = []
    for door in doors:
        cx, cy, width, height, angle = door
        nearest_wall, dist = _nearest_wall(outer_walls, (cx, cy))
        if dist <= 0.5:  # 외벽 0.5m 이내
            candidates.append({
                "center": (cx, cy),
                "width": width,
                "wall_segment_id": id(nearest_wall),
                "distance": dist,
            })
    
    if not candidates:
        # 외벽 매칭 실패 → 모든 문 중 가장 큰 것
        cx, cy, width, _, _ = max(doors, key=lambda d: d[2])
        return {"center": (cx, cy), "width": width, "wall_segment_id": None,
                "confidence": 0.5}
    
    # 외벽 후보 중 가장 큰 것
    best = max(candidates, key=lambda c: c["width"])
    best["confidence"] = 1.0
    return best


def find_primary_window_face(
    windows: List[tuple],         # [(cx, cy, width, height, angle), ...]
    walls: List[WallSegment],
) -> Optional[Dict]:
    """
    1. 외벽 segment 마다 그 위에 붙은 창문 그룹화
    2. 창문 폭 합이 가장 큰 segment = 주 채광면
    """
    if not windows or not walls:
        return None
    
    outer_walls = _compute_outer_walls(walls)
    if not outer_walls:
        return None
    
    # 외벽 segment 별 창문 매핑
    by_wall: Dict[int, List] = {}
    for window in windows:
        cx, cy, width, _, _ = window
        nearest, dist = _nearest_wall(outer_walls, (cx, cy))
        if dist <= 0.3:  # 외벽 0.3m 이내
            by_wall.setdefault(id(nearest), []).append(window)
    
    if not by_wall:
        return None
    
    # 가장 많이 모인 외벽
    best_id = max(by_wall.keys(), key=lambda k: sum(w[2] for w in by_wall[k]))
    best_wall = next(w for w in outer_walls if id(w) == best_id)
    group = by_wall[best_id]
    
    return {
        "midpoint": best_wall.midpoint,
        "direction": best_wall.direction,
        "length": best_wall.length,
        "window_count": len(group),
        "total_window_width": sum(w[2] for w in group),
        "confidence": 1.0,
    }


# ─── 내부 헬퍼 ─────────────────────────────────────

def _compute_outer_walls(walls: List[WallSegment]) -> List[WallSegment]:
    """모든 wall centerline 의 outer perimeter 추출.
    
    간단 구현:
    1. 모든 segment 의 endpoint 모음
    2. ConvexHull → 외곽
    3. 외곽 가까운 (distance < 1m) segment 만 outer 로 분류
    """
    if not walls:
        return []
    
    points = []
    for w in walls:
        points.append(w.start)
        points.append(w.end)
    points = np.array(points)
    
    try:
        from scipy.spatial import ConvexHull
        hull = ConvexHull(points)
        hull_polygon = Polygon(points[hull.vertices])
    except Exception:
        return walls  # 폴백: 모두 외벽으로 간주
    
    outer = []
    for w in walls:
        midpoint = Point(w.midpoint)
        if hull_polygon.exterior.distance(midpoint) < 1.0:
            outer.append(w)
    
    return outer if outer else walls


def _nearest_wall(walls: List[WallSegment], point: tuple) -> tuple:
    """주어진 점에 가장 가까운 wall segment 와 거리 반환."""
    p = Point(point)
    best, best_dist = None, float("inf")
    for w in walls:
        line = LineString([w.start, w.end])
        d = line.distance(p)
        if d < best_dist:
            best, best_dist = w, d
    return best, best_dist
```

### 통합 파이프라인 (`pipeline.py`)

```python
async def preprocess_building(
    building_id: str,
    files: List[Path],
    ai_server_url: str,
) -> BuildingManifest:
    """건물 1개 처리. 호출 즉시 status.json 업데이트 + 모든 PNG 생성."""
    output_dir = PROCESSED_DIR / building_id
    output_dir.mkdir(parents=True, exist_ok=True)
    layers_dir = output_dir / "layers"
    layers_dir.mkdir(exist_ok=True)
    
    update_status(building_id, "running", "init", 0)
    floors = []
    
    try:
        for file_idx, dxf in enumerate(files):
            file_id = dxf.stem
            
            # 1. 분류 (학과서버 /api/classify)
            update_status(building_id, "running", "classify", 10 + file_idx * 20)
            classify_result = await call_ai_classify(dxf, ai_server_url)
            wall_layers = [l for l, c in classify_result["layer_decisions"].items() if c == "wall"]
            door_layers = [l for l, c in classify_result["layer_decisions"].items() if c == "door"]
            window_layers = [l for l, c in classify_result["layer_decisions"].items() if c == "window"]
            
            # 2. 평면도 검출 (학과서버 /api/detect-floorplan)
            update_status(building_id, "running", "detect_floorplan", 30 + file_idx * 20)
            floorplan_result = await call_detect_floorplan(dxf, ai_server_url)
            
            # 3. 출입구/창문 분석 (휴리스틱, AWS 측)
            update_status(building_id, "running", "openings", 50 + file_idx * 20)
            from services.lod.centerline import reconstruct_centerline
            centerline = reconstruct_centerline(str(dxf), wall_layers)
            
            doors = _extract_doors_from_layer(...)  # services.lod.lod3_simple 헬퍼 재사용
            windows = _extract_windows_from_layer(...)
            
            main_entrance = find_main_entrance(doors, centerline.segments)
            primary_window = find_primary_window_face(windows, centerline.segments)
            
            # 4. ⭐ 시각화 (Phase B)
            update_status(building_id, "running", "visualize", 70 + file_idx * 20)
            from .visualizer import (
                render_layer_overlay, render_overlay_4color,
                render_floorplans_marked, render_openings_marked, render_thumbnail
            )
            render_overlay_4color(dxf, classify_result["layer_decisions"],
                                  output_dir / f"overlay_{file_id}.png")
            render_layer_overlay(dxf, wall_layers, COLOR_WALL, layers_dir / f"wall_{file_id}.png")
            render_layer_overlay(dxf, door_layers, COLOR_DOOR, layers_dir / f"door_{file_id}.png")
            render_layer_overlay(dxf, window_layers, COLOR_WINDOW, layers_dir / f"window_{file_id}.png")
            render_floorplans_marked(dxf, floorplan_result["floorplans"],
                                     floorplan_result["extent_dxf"],
                                     output_dir / f"floorplans_{file_id}.png")
            render_openings_marked(dxf, main_entrance, primary_window,
                                   output_dir / f"openings_{file_id}.png")
            render_thumbnail(dxf, output_dir / f"thumb_{file_id}.png")
            
            # 5. Floor 객체 생성 (한 DXF 에 다중 평면도 시 여러 개)
            for fp in floorplan_result["floorplans"]:
                floors.append(Floor(
                    floor_index=fp.get("floor_index", -1),
                    floor_label=fp.get("label", f"floor_{len(floors)}"),
                    file_id=file_id,
                    bounds=Bounds(**_normalize_to_dxf_bounds(fp["bbox"], floorplan_result["extent_dxf"])),
                    wall_layers=wall_layers,
                    door_layers=door_layers,
                    window_layers=window_layers,
                    main_entrance=Entrance(**main_entrance) if main_entrance else None,
                    primary_window_face=WindowFace(**primary_window) if primary_window else None,
                ))
        
        # 6. floor_index 정렬 + 매니페스트 저장
        floors.sort(key=lambda f: (f.floor_index if f.floor_index >= 0 else 999, f.floor_label))
        # floor_index 가 -1 이면 순서대로 0부터 부여
        for i, f in enumerate(floors):
            if f.floor_index < 0:
                f.floor_index = i
        
        # 메인 출입구는 1층(floor_index=0) 에만 유지
        for f in floors:
            if f.floor_index != 0:
                f.main_entrance = None
        
        manifest = BuildingManifest(
            building_id=building_id,
            files=[f.name for f in files],
            floors=floors,
            coordinate_alignment="bbox_centroid",
            created_at=datetime.utcnow().isoformat(),
            updated_at=datetime.utcnow().isoformat(),
        )
        save_manifest(manifest, output_dir / "manifest.json")
        update_status(building_id, "completed", "done", 100)
        
        return manifest
    
    except Exception as e:
        update_status(building_id, "failed", "error", error=str(e))
        raise
```

### DoD

- [ ] arquitectura.dxf 1개 입력 → manifest 에 평면도 N개 분리
- [ ] 호민님이 만든 폴더 구조 (1F.dxf, 2F.dxf) → manifest 에 floors 배열
- [ ] 모든 PNG 자동 생성 (관리자 갤러리에서 검수 가능)
- [ ] 실패 케이스 status.json 에 error 기록 (다른 건물 처리 계속)

---

## 6. Phase D — 자동화 스케줄러

**위치**: `building_cesium/backend/services/preprocess/scheduler.py`
**예상 시간**: 2~3시간

### 전략

cron 또는 FastAPI BackgroundTasks 로 1회 실행. 처리 안 된 건물 (`data/processed/{building_id}/manifest.json` 없는 폴더) 만 골라서 처리.

```python
async def run_preprocess_for_unprocessed():
    """raw_dir 의 모든 건물 폴더 검사 → manifest 없는 건물 처리."""
    from .clusterer import cluster_buildings
    
    groups = cluster_buildings(RAW_DIR / "manual")
    groups.update(cluster_buildings(RAW_DIR / "auto"))
    
    for building_id, files in groups.items():
        manifest_path = PROCESSED_DIR / building_id / "manifest.json"
        if manifest_path.exists():
            continue  # 이미 처리됨
        
        try:
            await preprocess_building(building_id, files, AI_SERVER_URL)
        except Exception as e:
            logger.error(f"{building_id} 실패: {e}")
            continue
```

### 트리거 방법

옵션 1 — cron:
```bash
# crontab 등록
0 2 * * * cd /home/ec2/building_cesium/backend && \
   .venv/bin/python -m services.preprocess.scheduler >> /var/log/preprocess.log 2>&1
```

옵션 2 — 관리자 트리거 API:
```python
@app.post("/api/admin/preprocess/run")
async def trigger_preprocess(background: BackgroundTasks):
    background.add_task(run_preprocess_for_unprocessed)
    return {"started": True}
```

→ **둘 다 구현 권장**. 자동 + 수동.

### DoD

- [ ] 명령어 한 번으로 모든 미처리 건물 자동 처리
- [ ] /admin/ai 에 "지금 시작" 버튼 (BackgroundTasks 트리거)
- [ ] 처리 도중 새로고침해도 진행률 폴링 가능 (status.json)

---

## 7. Phase E — 관리자 갤러리 UI

**위치**: `building_cesium/frontend/components/admin/PreprocessGallery.tsx` (신규)
**예상 시간**: 5~6시간

### UI 구성

`/admin/ai` 의 "AI 모델 관리" 탭 아래 새 섹션 또는 별도 페이지 `/admin/ai/preprocess`.

```
┌──────────────────────────────────────────────────────────────┐
│ 📦 전처리된 데이터셋 (총 234개 building, 마지막 갱신 2시간 전) │
│ [ 검색 ] [ 필터: 전체 ▼ ] [ 🔄 지금 처리 시작 ]              │
├──────────────────────────────────────────────────────────────┤
│ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐              │
│ │ thumb   │ │ thumb   │ │ thumb   │ │ thumb   │              │
│ │ house_a │ │ apt_001 │ │ arquit. │ │ house_b │              │
│ │ 📁2 floors │ 📁1     │ 📁3     │ 📁2     │              │
│ │ ✅✅✅  │ ✅⚠️❌  │ ✅✅✅  │ 처리중  │              │
│ │[상세]   │ │[상세]   │ │[상세]   │ │[취소]   │              │
│ └─────────┘ └─────────┘ └─────────┘ └─────────┘              │
└──────────────────────────────────────────────────────────────┘
```

상태 배지 의미: `분류✅ 평면도검출✅ 출입구✅` 또는 ⚠️/❌

### 상세 모달

```
┌──────────────────────────────────────────────────┐
│ house_a (2 floors)               [×]             │
├──────────────────────────────────────────────────┤
│ ┌─────────┐ ┌─────────┐                          │
│ │ original │ │overlay 4│   ← 분류 결과 검증      │
│ ├─────────┤ ├─────────┤                          │
│ │ wall    │ │ door    │                          │
│ ├─────────┤ ├─────────┤                          │
│ │ window  │ │openings │   ← 출입구 검증          │
│ └─────────┘ └─────────┘                          │
│                                                  │
│ ▼ 평면도 검출 결과                               │
│ • 1F: bbox (0.05, 0.10, 0.45, 0.50)             │
│ • 2F: bbox (0.55, 0.10, 0.95, 0.50)             │
│                                                  │
│ ▼ 메인 출입구: (-15.3, 282.1), width 0.9m, 신뢰 1.0 │
│ ▼ 주 창문 면: 길이 8.2m, 창 4개, 신뢰 1.0          │
│                                                  │
│ [매니페스트 JSON 보기]                           │
│ [🔄 재처리]  [🗑 폐기]  [✅ 학습 데이터 승인]   │
└──────────────────────────────────────────────────┘
```

### API

새 엔드포인트:
```python
@app.get("/api/admin/preprocess/buildings")
async def list_buildings(state: Optional[str] = None):
    """모든 건물 + status."""

@app.get("/api/admin/preprocess/buildings/{building_id}")
async def get_building_detail(building_id: str):
    """매니페스트 + PNG URL 목록."""

@app.get("/api/admin/preprocess/images/{building_id}/{filename}")
async def serve_image(building_id: str, filename: str):
    """PNG 파일 서빙."""

@app.post("/api/admin/preprocess/buildings/{building_id}/approve")
async def approve_for_training(building_id: str):
    """학습 데이터로 승인 (manifest 에 approved=True 마킹)."""

@app.post("/api/admin/preprocess/buildings/{building_id}/reprocess")
async def reprocess_building(building_id: str, background: BackgroundTasks):
    """매니페스트 삭제 후 재처리."""
```

### DoD

- [ ] 관리자가 200개 건물을 갤러리로 빠르게 훑을 수 있음 (썸네일 < 50KB 각)
- [ ] 상세 모달에서 6장 PNG 다 보임
- [ ] 분류 결과가 잘못된 케이스 (⚠️/❌) 가 시각적으로 식별
- [ ] "승인" 누르면 학습 데이터 폴더에 symlink 또는 메타에 표시

---

## 8. Phase F — 다층 매스 생성 API

**위치**: `building_cesium/backend/main.py`, `services/lod/multi_floor.py` (신규)
**예상 시간**: 3시간

### multi_floor.py

```python
def build_multi_floor_mass(
    manifest: BuildingManifest,
    floor_height: float = 3.5,
    output_path: str = None,
) -> dict:
    """매니페스트 기반 다층 매스 GLB 생성.
    
    각 층 매스를 build_lod3_simple_meshonly() 로 생성 후
    z 축 stacking + 좌표 정렬.
    """
    meshes = []
    for floor in manifest.floors:
        # 각 층 매스 (메모리)
        m = build_lod3_simple_meshonly(
            dxf_path=DATA_DIR / "raw" / ... / f"{floor.file_id}.dxf",
            wall_layers=floor.wall_layers,
            door_layers=floor.door_layers,
            window_layers=floor.window_layers,
            height=floor_height,
            bounds=floor.bounds.dict() if floor.bounds else None,
        )
        
        # 좌표 정렬
        m = _align_to_origin(m, mode=manifest.coordinate_alignment)
        
        # z 축 이동
        m = m.apply_translation([0, 0, floor.floor_index * floor_height])
        meshes.append(m)
    
    # 합치기
    combined = trimesh.util.concatenate(meshes)
    if output_path:
        combined.export(output_path)
    
    return {
        "success": True,
        "floors_count": len(manifest.floors),
        "total_height": len(manifest.floors) * floor_height,
        "main_entrance": manifest.floors[0].main_entrance.dict() if manifest.floors[0].main_entrance else None,
        "primary_window_faces": [
            f.primary_window_face.dict() for f in manifest.floors if f.primary_window_face
        ],
    }
```

### API 엔드포인트

```python
@app.post("/api/generate-mass-multi", response_model=MultiFloorMassResponse)
async def generate_multi_floor_mass(req: MultiFloorMassRequest):
    """매니페스트 기반 다층 매스."""
    manifest = load_manifest(req.building_id)
    if not manifest:
        raise HTTPException(404, f"건물 매니페스트 없음: {req.building_id}")
    
    model_id = str(uuid.uuid4())
    output_path = MODELS_DIR / f"{model_id}.glb"
    
    result = build_multi_floor_mass(
        manifest=manifest,
        floor_height=req.floor_height,
        output_path=str(output_path),
    )
    
    return MultiFloorMassResponse(
        success=True,
        model_id=model_id,
        model_url=f"/static/models/{model_id}.glb",
        building_id=req.building_id,
        **result,
    )
```

### lod3_simple.py 확장

```python
def build_lod3_simple_meshonly(...) -> trimesh.Trimesh:
    """기존 build_lod3_simple 의 메모리만 반환 변형. 파일 출력 X."""
```

### DoD

- [ ] arquitectura.dxf (3 평면도) 매니페스트 → 3층 매스 생성
- [ ] 각 층이 z 축으로 분리되어 보임
- [ ] 응답에 main_entrance + primary_window_faces 포함 (Cesium 마커용)

---

## 9. Phase G (선택, v1.1+) — 새 라벨 학습 통합

**위치**: `ai_layer_classifier/training/train.py` 확장
**예상 시간**: 3~4시간
**전제**: 데이터 1000개+ 쌓였을 때

### 작업

매니페스트의 main_entrance / primary_window_face 메타데이터를 학습 입력으로 추가:

- 새 컬럼: `is_main_entrance` (bool), `is_primary_window_face` (bool)
- 별도 모델: 출입구 binary classifier (door 엔티티 중 메인인지)
- 또는 multi-output: 기존 4클래스 + 메인 출입구 binary

→ v1.0 (5/18) 까지 휴리스틱만으로 동작 후, 데이터 쌓이면 학습 보강.

---

## 10. 회귀 테스트 체크리스트 (매 Phase 완료 시)

```
[ ] LOD1 동등성: 기존 generate-mass (lod=1) 결과 unchanged
[ ] LOD3 Simple 동등성: 기존 generate-mass (lod=3) 결과 unchanged
[ ] 매스 인터랙션: /editor 드래그/회전 정상
[ ] 일조분석/규정검토: LOD1 대비 ±5% 이내
[ ] 매니페스트 lookup 시간 < 200ms (ssd 기준)
[ ] PNG 5종 합 < 5MB per building (관리자 갤러리 부하)
[ ] preprocess 1 building 처리 시간 < 60s (vLLM 호출 포함)
```

---

## 11. 일정 + 분담

| Phase | 시간 | 담당 | 마일스톤 |
|---|---|---|---|
| A. detect-floorplan API | 1~2h | 신재훈 | v0.6 (5/4) |
| B. visualizer | 3~4h | 호민님 | v0.6 |
| C. 전처리 파이프라인 | 5~6h | 호민님+신재훈 | v1.0 (5/18) |
| D. 스케줄러 | 2~3h | 호민님 | v1.0 |
| E. 관리자 UI | 5~6h | 호민님 (프론트) | v1.0 |
| F. 다층 매스 | 3h | 신재훈 | v1.0 |
| G. 새 라벨 학습 | 3~4h | 신재훈 | v1.1 (5/25, 선택) |

**총 22~28시간**. 호민님+신재훈 분담 시 v1.0 완료.

---

## 12. 시연 동선 (v1.0 완성 후)

```
1. 사용자가 DXF 업로드 (단일 또는 zip)
2. 백엔드가 자동으로 폴더 = 건물 그룹화
3. /admin/ai 에서 관리자가 "처리 시작" → 진행률 보임
4. 처리 완료 → 갤러리에 thumbnail 추가
5. 관리자가 갤러리 검수 → "승인"
6. 사용자 측 매스 생성: building_id 선택 → "다층 매스 생성"
7. Cesium 에 다층 매스 + 메인 출입구 빨간 마커 + 주 창문면 노란 strip 표시
8. (옵션) 스코어링: 메인 출입구 향, 주 창문면 향 정보 활용
```

---

## 13. 시작 명령어 (호민님이 사용)

PC 에서:

```powershell
cd C:\Users\user\Desktop\26-1\building_cesium
.\backend\venv\Scripts\Activate.ps1
claude
```

Claude Code 첫 메시지 (그대로 복붙):

```
docs/lod/PHASE_A-G_pipeline.md 와 docs/lod/CLAUDE.md 를 먼저 읽고,
Phase A 부터 순서대로 진행해. 결정사항 (1번 섹션) 은 재논의 금지.

각 Phase 완료 시:
1. 회귀 테스트 체크리스트 (10번 섹션) 결과 보고
2. 호민님 컨펌 받은 후 다음 Phase

특히 호민님 핵심 요구는 "각 단계 PNG 시각화"
(Phase B 의 5종 PNG + Phase E 의 갤러리 UI). 이 부분은 디테일 챙기기.
```

---

## 14. Cowork ↔ Claude Code 분담

작업 진행 중 Cowork 세션에서 처리할 일:
- 학과 AI 서버 SSH 작업 (Phase A 배포)
- 노션 회의록 갱신 (각 Phase 완료 시)
- 진도표 v0.6 → v1.0 매트릭스 갱신
- AWS 배포 (git push + EC2 build)
- 회귀 테스트 결과 분석 + 디버깅

Claude Code 단독으로 처리:
- Phase B, C, D, F (백엔드 코드)
- Phase E (프론트)
- 단위 테스트 작성/실행
- 매니페스트 디버깅

각 Phase 완료 후 Cowork 들러서 진척 보고 → 회의록 갱신 → 다음 Phase 진행.
