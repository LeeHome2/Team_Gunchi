# Phase H — 단일 평면도 집중 + 샘플 분리

> **Claude Code 가 이 문서부터 읽고 시작.** 호민님이 2026-05-13 Cowork 세션에서 결정한 사항. 재논의 금지.
> 선행: README.md, HANDOFF.md, CLAUDE.md, STATUS.md, PHASE_A-G_pipeline.md

---

## 0. 1분 요약 (오늘 지시 4가지)

1. **단일 평면도 앱으로 전환** — vLLM detect-floorplan 기본 skip
2. **데이터셋1 (98개) 정확도 우선** — LOD3 Simple 매스화가 대부분 도면에 정상 동작
3. **출입구/창문 매칭 결과를 사용자 모달**에서 확인
4. **샘플 도면 분리** — 파일명 자동 분기 제거, 사이드바 명시적 샘플 선택만

---

## 1. 결정사항 (재논의 금지)

| 항목 | 결정 |
|---|---|
| 다중 평면도 처리 | **v1.1 으로 연기**. 시연은 단일 평면도만 |
| vLLM detect-floorplan | **기본 skip**, `assume_single_floorplan=True` 디폴트 |
| 사용자 흐름 | DXF 업로드 → 분류 → LOD3 Simple 매스 → 결과 모달 (즉시) |
| arquitectura.dxf 같은 다중 평면도 | 사이드바 "샘플 도면" 카드 클릭 시에만 처리 |
| 파일명 기반 자동 분기 | **전부 제거** — `sample_preset` 필드로 명시적 전달만 |
| 데이터셋 목표 적용률 | LOD3 Simple 매스 정상 생성 **80%+** |

---

## 2. 작업 흐름 — 4개 작업 순서대로

```
[1] 관리자 전처리 단일 평면도 기본화
        ↓
[2] 데이터셋1 벌크 검증 + LOD3 Simple 정확도 보강
        ↓
[3] 출입구/창문 매칭 결과 사용자 모달
        ↓
[4] 샘플 도면 분리 (파일명 자동 분기 제거)
```

각 작업 완료 시 호민님 컨펌 받고 다음으로.

---

## 3. 작업 [1] — vLLM detect-floorplan 기본 skip

### 변경 위치

**`backend/services/preprocess/pipeline.py:187`** — `preprocess_building` 시그니처 변경

```python
async def preprocess_building(
    building_id: str,
    files: List[Path],
    ai_server_url: str = AI_SERVER_URL,
    mock: bool = False,
    assume_single_floorplan: bool = True,  # ★ 신규, 기본 True
) -> BuildingManifest:
    ...
```

### 분기 처리 (3번 단계 교체)

```python
# 3. 평면도 검출
update_status(building_id, "running", "detect_floorplan", base_progress + 30, processed_dir=PROCESSED_DIR)

if assume_single_floorplan:
    # 단일 평면도 모드 — vLLM 호출 skip
    import ezdxf
    from ezdxf import bbox as ezbbox
    try:
        doc = ezdxf.readfile(str(dxf))
        ext = ezbbox.extents(doc.modelspace(), fast=True)
        if ext and ext.has_data:
            extent = {
                "min_x": float(ext.extmin.x), "min_y": float(ext.extmin.y),
                "max_x": float(ext.extmax.x), "max_y": float(ext.extmax.y),
            }
        else:
            extent = {"min_x": 0, "min_y": 0, "max_x": 1, "max_y": 1}
    except Exception:
        extent = {"min_x": 0, "min_y": 0, "max_x": 1, "max_y": 1}

    floorplan_result = {
        "floorplans_found": True,
        "floorplans": [{
            "label": "1F",
            "floor_index": 0,
            "bbox": {"x_min": 0.0, "y_min": 0.0, "x_max": 1.0, "y_max": 1.0},
            "reason": "single floorplan mode (vLLM skipped)",
        }],
        "extent_dxf": extent,
    }
else:
    # 기존 vLLM 호출 (v1.1 이후 다중 평면도 지원 시)
    try:
        floorplan_result = await call_detect_floorplan(dxf, ai_server_url, mock=mock)
    except Exception as e:
        logger.warning(f"평면도 검출 실패 {dxf.name}: {e}")
        floorplan_result = {
            "floorplans_found": False,
            "floorplans": [],
            "extent_dxf": {"min_x": 0, "min_y": 0, "max_x": 1, "max_y": 1},
        }
```

### admin API 옵션 노출

**`backend/api/admin_routes.py:1296`** — `/preprocess/run` 요청에 옵션

```python
class PreprocessRunRequest(BaseModel):
    force_single: bool = True  # 기본 단일 평면도 모드
    mock: bool = False

@router.post("/preprocess/run")
async def trigger_preprocess(
    req: PreprocessRunRequest,
    background: BackgroundTasks,
):
    background.add_task(
        run_preprocess_for_unprocessed,
        assume_single_floorplan=req.force_single,
        mock=req.mock,
    )
    return {"started": True, "single_mode": req.force_single}
```

`/preprocess/buildings/{id}/reprocess` 도 동일 옵션 추가.

### DoD

- [ ] `assume_single_floorplan=True` (기본) 호출 시 vLLM detect-floorplan 호출 안 됨
- [ ] arquitectura.dxf 도 통째로 한 평면도로 처리됨 (다중 평면도 분리 X)
- [ ] 단일 평면도 DXF (데이터셋1) 는 정상 동작
- [ ] 처리 시간 단축 측정 — 기존 평균 vs 신규

---

## 4. 작업 [2] — 데이터셋1 벌크 검증 + LOD3 Simple 보강

### 벌크 검증 테스트

**`backend/tests/test_dataset1_mass.py` 신규**:

```python
"""데이터셋1 의 98개 DXF 에 대해 LOD3 Simple 매스 생성 성공률 측정."""
import pytest
import json
from pathlib import Path
from datetime import datetime
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.lod.lod3_simple import build_lod3_simple

# 실제 경로는 환경변수 또는 직접 지정
DATASET1 = Path("/sessions/intelligent-trusting-fermat/mnt/26-1/데이터셋1-dxf/dxf")
# 호민님 PC 에서는: Path(r"C:\Users\user\Desktop\26-1\데이터셋1-dxf\dxf")
OUTPUT_DIR = Path("/tmp/dataset1_mass_results")
REPORT_PATH = Path(__file__).parent.parent / "docs/lod/dataset1_coverage.md"


def get_layers_from_dxf(dxf_path):
    """DXF 의 모든 레이어 추출 (분류 mock 용)."""
    import ezdxf
    doc = ezdxf.readfile(str(dxf_path))
    return [layer.dxf.name for layer in doc.layers]


def classify_by_keyword(layers):
    """키워드 기반 간단 분류 (vLLM 없이 테스트)."""
    wall_kw = ["wall", "벽", "wal", "외벽", "내벽", "structural"]
    door_kw = ["door", "문", "dr", "출입"]
    window_kw = ["window", "창", "win", "wd"]
    
    wall_layers, door_layers, window_layers = [], [], []
    for l in layers:
        ll = l.lower()
        if any(k in ll for k in wall_kw):
            wall_layers.append(l)
        elif any(k in ll for k in door_kw):
            door_layers.append(l)
        elif any(k in ll for k in window_kw):
            window_layers.append(l)
    return wall_layers, door_layers, window_layers


@pytest.mark.skipif(not DATASET1.exists(), reason="데이터셋1 경로 없음")
def test_dataset1_coverage():
    """데이터셋1 의 80%+ 에서 LOD3 Simple 정상 매스 생성."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    dxfs = sorted(DATASET1.glob("*.dxf"))
    assert len(dxfs) > 0
    
    results = {"ok": [], "no_walls": [], "exception": []}
    
    for dxf in dxfs:
        try:
            layers = get_layers_from_dxf(dxf)
            wall_layers, door_layers, window_layers = classify_by_keyword(layers)
            
            if not wall_layers:
                results["no_walls"].append(dxf.name)
                continue
            
            r = build_lod3_simple(
                str(dxf), wall_layers, door_layers, window_layers,
                height=3.5, output_path=str(OUTPUT_DIR / f"{dxf.stem}.glb"),
            )
            
            if r and r.get("success") and r.get("mesh_stats", {}).get("vertices", 0) > 0:
                results["ok"].append({"file": dxf.name, "vertices": r["mesh_stats"]["vertices"]})
            else:
                results["exception"].append({"file": dxf.name, "reason": "empty_mesh"})
        except Exception as e:
            results["exception"].append({"file": dxf.name, "reason": str(e)[:100]})
    
    success_rate = len(results["ok"]) / len(dxfs)
    
    # 리포트 작성
    report = f"""# 데이터셋1 LOD3 Simple 매스 적용률

생성: {datetime.now().isoformat()}
대상: {len(dxfs)} 개 DXF
성공: {len(results['ok'])} ({success_rate*100:.1f}%)
벽 없음: {len(results['no_walls'])}
실패: {len(results['exception'])}

## 실패 케이스

### 벽 레이어 미감지
{chr(10).join('- ' + n for n in results['no_walls'])}

### 매스 생성 실패
{chr(10).join('- ' + e['file'] + ': ' + e.get('reason', '?') for e in results['exception'])}

## 성공 케이스 (정점 수)
{chr(10).join('- ' + r['file'] + ': v=' + str(r['vertices']) for r in results['ok'][:10])}
"""
    REPORT_PATH.write_text(report, encoding="utf-8")
    
    print(f"\n=== 데이터셋1 LOD3 Simple: {len(results['ok'])}/{len(dxfs)} = {success_rate*100:.1f}% ===")
    print(f"리포트: {REPORT_PATH}")
    
    assert success_rate >= 0.80, f"목표 80% 미달: {success_rate*100:.1f}%"
```

### LOD3 Simple 보강 항목 (테스트 실패 케이스 보고 결정)

다음 보강 옵션, 80% 안 나오면 적용:

1. **DXF 스케일 감지 강화** — `_detect_dxf_scale()` 의 INSUNITS 우선
2. **레이어명 키워드 휴리스틱 폴백** — 분류 결과 비어있을 때 lod3_simple 안에서 직접 처리
3. **단일 LINE 무시 임계값 조정** — 너무 짧은 LINE 무시 (현재 0.001m)
4. **신재훈 opening clustering 도입** (옵션) — 산재된 문/창 병합

### DoD

- [ ] `test_dataset1_coverage()` 80%+ 통과
- [ ] `docs/lod/dataset1_coverage.md` 생성 — 어떤 파일이 실패했고 왜
- [ ] 실패 케이스 분석 후 LOD3 Simple 패치 1라운드 (있으면)

---

## 5. 작업 [3] — 출입구/창문 매칭 결과 사용자 모달

### API 응답 검증

`MassGenerateResponse` 와 `MultiFloorMassResponse` 가 다음 필드 포함하는지 확인:

```python
class MassGenerateResponse(BaseModel):
    ...
    lod_actual: int
    main_entrance: Optional[EntranceInfo] = None     # ★ 있어야 함
    primary_window_face: Optional[WindowFaceInfo] = None
```

없으면 추가. `EntranceInfo`, `WindowFaceInfo` 는 이미 `api/models.py` 에 정의됨 (확인 완료).

### Cesium 마커 (없으면 추가)

**`frontend/components/CesiumViewer.tsx` 또는 `frontend/hooks/useMassMarkers.ts` (신규)**:

```typescript
export function useMassMarkers(
  viewer: Cesium.Viewer | null,
  mainEntrance: EntranceInfo | null,
  primaryWindowFace: WindowFaceInfo | null,
  modelTransform: ModelTransform,
) {
  useEffect(() => {
    if (!viewer) return
    const entityIds: string[] = []

    // 메인 출입구 — 빨간 ●
    if (mainEntrance) {
      const [lon, lat] = localToLonLat(mainEntrance.center, modelTransform)
      const id = `entrance_${Date.now()}`
      viewer.entities.add({
        id,
        position: Cesium.Cartesian3.fromDegrees(lon, lat, 0.5),
        billboard: {
          image: '/markers/entrance_red.png',  // 또는 폴리곤 원
          scale: 1.2,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        },
        label: {
          text: `🚪 메인 출입구 (${mainEntrance.width.toFixed(1)}m)`,
          font: '12px sans-serif',
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -30),
        },
      })
      entityIds.push(id)
    }

    // 주 창문 면 — 노란 선분
    if (primaryWindowFace) {
      const [mx, my] = primaryWindowFace.midpoint
      const [dx, dy] = primaryWindowFace.direction
      const len = primaryWindowFace.length / 2
      const p1 = localToLonLat([mx - dx * len, my - dy * len], modelTransform)
      const p2 = localToLonLat([mx + dx * len, my + dy * len], modelTransform)
      const id = `window_face_${Date.now()}`
      viewer.entities.add({
        id,
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArrayHeights([
            p1[0], p1[1], 0.5,
            p2[0], p2[1], 0.5,
          ]),
          width: 5,
          material: Cesium.Color.fromCssColorString('#FFD700'),
        },
      })
      entityIds.push(id)
    }

    return () => {
      entityIds.forEach((id) => viewer.entities.removeById(id))
    }
  }, [viewer, mainEntrance, primaryWindowFace, modelTransform])
}
```

### MassResultModal (신규)

**`frontend/components/MassResultModal.tsx` 신규**:

```tsx
'use client'

import { EntranceInfo, WindowFaceInfo } from '@/lib/api'

interface Props {
  result: {
    lod_actual: number
    main_entrance: EntranceInfo | null
    primary_window_face: WindowFaceInfo | null
    mesh_stats?: { vertices: number; faces: number }
  }
  onClose: () => void
}

export default function MassResultModal({ result, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="card max-w-lg w-full p-6 m-4">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold">✅ 매스 생성 완료</h3>
            <p className="text-xs text-white/50 mt-1">
              AI 가 분류한 결과를 매스에 적용했습니다
            </p>
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white text-2xl">×</button>
        </div>

        {/* LOD 정보 */}
        <div className="bg-blue-500/10 border border-blue-400/30 rounded p-3 mb-3">
          <div className="text-xs text-white/60">적용된 LOD 레벨</div>
          <div className="text-2xl font-semibold text-blue-300">LOD {result.lod_actual}</div>
          {result.lod_actual === 3 && (
            <div className="text-[11px] text-white/50 mt-1">
              벽(회색) · 문(주황) · 창문(하늘) 색상 분리
            </div>
          )}
        </div>

        {/* 메인 출입구 */}
        <section className="mb-3">
          <h4 className="text-sm font-semibold mb-2">🚪 메인 출입구</h4>
          {result.main_entrance ? (
            <div className="bg-white/5 rounded p-3 space-y-1 text-xs">
              <Row label="위치" value={`(${result.main_entrance.center[0].toFixed(2)}, ${result.main_entrance.center[1].toFixed(2)})`} mono />
              <Row label="문 폭" value={`${result.main_entrance.width.toFixed(2)} m`} />
              <Row label="신뢰도" value={`${(result.main_entrance.confidence * 100).toFixed(0)}%`} />
              <Row label="외벽 매칭" value={result.main_entrance.wall_segment_id ? '✅ 확인됨' : '⚠ 매칭 못 함'} />
              <p className="text-[10px] text-white/40 mt-2">
                지도에서 빨간 ● 마커로 표시됨
              </p>
            </div>
          ) : (
            <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-400/30 rounded p-2">
              ⚠ 메인 출입구 자동 감지 실패 — 문 레이어가 없거나 외벽 매칭 실패
            </div>
          )}
        </section>

        {/* 주 창문 면 */}
        <section className="mb-3">
          <h4 className="text-sm font-semibold mb-2">🪟 주 채광면</h4>
          {result.primary_window_face ? (
            <div className="bg-white/5 rounded p-3 space-y-1 text-xs">
              <Row label="중심점" value={`(${result.primary_window_face.midpoint[0].toFixed(2)}, ${result.primary_window_face.midpoint[1].toFixed(2)})`} mono />
              <Row label="면 길이" value={`${result.primary_window_face.length.toFixed(2)} m`} />
              <Row label="창문 개수" value={`${result.primary_window_face.window_count} 개`} />
              <Row label="창문 총 폭" value={`${result.primary_window_face.total_window_width.toFixed(2)} m`} />
              <Row label="방향 벡터" value={`[${result.primary_window_face.direction[0].toFixed(2)}, ${result.primary_window_face.direction[1].toFixed(2)}]`} mono />
              <p className="text-[10px] text-white/40 mt-2">
                지도에서 노란 ▬ 선으로 표시됨 (향후 스코어링에 사용)
              </p>
            </div>
          ) : (
            <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-400/30 rounded p-2">
              ⚠ 주 채광면 자동 감지 실패 — 창문 레이어 없음
            </div>
          )}
        </section>

        {/* 메쉬 통계 */}
        {result.mesh_stats && (
          <div className="grid grid-cols-2 gap-2 text-xs text-white/60 mt-3">
            <div>정점: <span className="font-mono">{result.mesh_stats.vertices.toLocaleString()}</span></div>
            <div>면: <span className="font-mono">{result.mesh_stats.faces.toLocaleString()}</span></div>
          </div>
        )}

        <button onClick={onClose} className="btn-primary w-full mt-4">확인</button>
      </div>
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-2">
      <span className="text-white/40 w-20 flex-shrink-0">{label}</span>
      <span className={`text-white/80 ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  )
}
```

### 매스 생성 후 자동 노출

매스 생성 호출하는 곳 (`editor/page.tsx` 또는 매스 탭 컴포넌트) 에서:

```typescript
const [massResult, setMassResult] = useState<MassResult | null>(null)

const handleGenerate = async () => {
  const result = await generateModel(...)
  setMassResult(result)
  // useMassMarkers 가 자동으로 마커 추가
}

return (
  <>
    ...
    {massResult && <MassResultModal result={massResult} onClose={() => setMassResult(null)} />}
  </>
)
```

### DoD

- [ ] 매스 생성 후 모달 자동 노출
- [ ] 메인 출입구가 있으면 위치/폭/신뢰도 표시, 없으면 경고
- [ ] 주 창문 면도 동일
- [ ] Cesium 위 빨간 ● + 노란 ▬ 마커 표시
- [ ] 마커는 매스 변환 (move/rotate) 따라 함께 이동

---

## 6. 작업 [4] — 샘플 도면 분리

### 프리셋 레지스트리

**`backend/services/lod/sample_presets.py` 신규**:

```python
"""시연용 샘플 도면 프리셋.

호민님이 데이터셋1 에서 검증한 도면들의 매스화 설정.
일반 사용자 업로드 흐름에는 절대 자동 적용 안 됨.
사이드바의 '샘플 도면' 카드 클릭 시에만 활성.
"""
from typing import Dict, Optional, TypedDict, List

class SamplePreset(TypedDict, total=False):
    name: str
    dxf_file: str           # data/raw/samples/ 안의 파일명 (또는 절대경로)
    description: str
    bounds: Optional[Dict[str, float]]  # 다중 평면도 자르기 (단일이면 None)
    wall_layers_override: Optional[List[str]]
    door_layers_override: Optional[List[str]]
    window_layers_override: Optional[List[str]]
    height: float
    thumbnail: str           # 미리보기 PNG URL (/api/samples/{id}/thumb)

SAMPLE_PRESETS: Dict[str, SamplePreset] = {
    "arquitectura": {
        "name": "Arquitectura (다중 평면도)",
        "dxf_file": "arquitectura.dxf",
        "description": "다중 평면도 중 좌상단 1층만 — 영역 자르기 사용",
        "bounds": {"min_x": -22, "max_x": -8, "min_y": 278, "max_y": 285},
        "height": 3.5,
        "thumbnail": "/static/samples/arquitectura.png",
    },
    "house_1bed": {
        "name": "1 Bed Apartment",
        "dxf_file": "14553569321165-1 Bed apartment plan.dxf",
        "description": "단일 평면도 · 1bed 주거",
        "bounds": None,
        "height": 3.0,
        "thumbnail": "/static/samples/house_1bed.png",
    },
    "office_53ft": {
        "name": "Office Space (50' × 53')",
        "dxf_file": "1587601309OFFICE SPACE FLOOR PLAN (50' X53').dxf",
        "description": "단일 사무실 평면",
        "bounds": None,
        "height": 3.5,
        "thumbnail": "/static/samples/office.png",
    },
    "student_accom": {
        "name": "Student Accommodation",
        "dxf_file": "14524557351136-Student accomodation floor plan.dxf",
        "description": "학생 숙소 단일 평면",
        "bounds": None,
        "height": 2.8,
        "thumbnail": "/static/samples/student.png",
    },
    # 호민님이 데이터셋1 에서 검증한 도면 추가
}

def get_preset(sample_id: str) -> Optional[SamplePreset]:
    return SAMPLE_PRESETS.get(sample_id)

def list_presets() -> List[Dict]:
    return [{"id": k, **v} for k, v in SAMPLE_PRESETS.items()]
```

### 샘플 DXF + 썸네일 파일 배치

```
backend/data/raw/samples/
├── arquitectura.dxf
├── 14553569321165-1 Bed apartment plan.dxf
└── ...

frontend/public/static/samples/  (또는 backend static)
├── arquitectura.png       # 200x200 미리보기
├── house_1bed.png
└── ...
```

썸네일은 `services/preprocess/visualizer.py:render_thumbnail` 로 한 번 생성해두기.

### API 모델 + 엔드포인트

**`backend/api/models.py:48`** — `MassGenerateRequest`:

```python
class MassGenerateRequest(BaseModel):
    ...
    sample_preset: Optional[str] = Field(
        None,
        description="샘플 프리셋 ID (sample_presets.py 의 키). None=일반 사용자 업로드"
    )
```

**`backend/main.py`** — 신규 엔드포인트:

```python
@app.get("/api/samples")
def list_samples_endpoint():
    """사이드바 샘플 도면 카드용."""
    from services.lod.sample_presets import list_presets
    return {"samples": list_presets()}
```

### main.py 의 파일명 자동 분기 제거

**`backend/main.py:756-790` (대략)** — 다음을 통째로 교체:

```python
# ⭐ 제거 대상 (있으면 삭제):
# if "arquitectura" in original_filename:
#     lod3_bounds = {"min_x": -22, "max_x": -8, "min_y": 278, "max_y": 285}

# ⭐ 변경 후 — sample_preset 명시적 분기만
lod3_bounds = None
preset_wall = preset_door = preset_window = None

if request.sample_preset:
    from services.lod.sample_presets import get_preset
    preset = get_preset(request.sample_preset)
    if preset:
        lod3_bounds = preset.get("bounds")
        preset_wall = preset.get("wall_layers_override")
        preset_door = preset.get("door_layers_override")
        preset_window = preset.get("window_layers_override")
        logger.info(f"샘플 프리셋: {request.sample_preset} bounds={lod3_bounds}")
    else:
        logger.warning(f"알 수 없는 sample_preset: {request.sample_preset}")

# preset 의 override 가 있으면 분류 결과 대신 사용
wall_layers = preset_wall if preset_wall else request.wall_layers
door_layers = preset_door if preset_door else request.door_layers
window_layers = preset_window if preset_window else request.window_layers
```

### 프론트 — 사이드바 샘플 카드

**`frontend/components/Sidebar.tsx`** — 업로드 탭 안에:

```tsx
{/* 기존 DXF 업로드 영역 */}
<FileUploadArea ... />

{/* ⭐ 신규: 샘플 도면 */}
<div className="mt-4 pt-4 border-t border-white/10">
  <h5 className="text-sm font-semibold text-white/70 mb-2">
    🎯 빠른 시작 (검증된 샘플)
  </h5>
  <p className="text-xs text-white/40 mb-3">
    호민님이 검증한 도면으로 즉시 시연
  </p>
  
  {samples.map(s => (
    <button
      key={s.id}
      onClick={() => handleSelectSample(s)}
      className="w-full mb-2 flex items-center gap-3 p-2 rounded border border-white/10 hover:bg-white/5"
    >
      <img src={s.thumbnail} className="w-12 h-12 rounded object-cover" alt="" />
      <div className="flex-1 text-left">
        <div className="text-sm font-medium">{s.name}</div>
        <div className="text-[10px] text-white/40">{s.description}</div>
      </div>
    </button>
  ))}
</div>
```

```typescript
async function handleSelectSample(sample: SamplePreset) {
  // 1. (옵션) 백엔드에서 샘플 DXF 미리 등록 — file_id 발급
  const { file_id } = await fetch(`/api/samples/${sample.id}/load`, { method: 'POST' }).then(r => r.json())
  
  // 2. 매스 생성 (sample_preset 명시!)
  await generateModel({
    fileId: file_id,
    sample_preset: sample.id,  // ★ 핵심
    lod: 3,
    ...
  })
}
```

### frontend/lib/analysisApi.ts 수정

`generateModel()` 함수의 body 에 `sample_preset` 전달:

```typescript
export async function generateModel(
  classification: ClassificationResult,
  ...,
  lod: 1 | 2 | 3 = 1,
  bounds?: Bounds,
  samplePreset?: string,  // ★ 신규
) {
  ...
  if (samplePreset) body.sample_preset = samplePreset
  ...
}
```

### DoD

- [ ] `arquitectura.dxf` 라는 이름으로 사용자가 업로드 시 — bounds 자동 적용 안 됨 확인
- [ ] 사이드바 샘플 카드 클릭 시 — bounds 정상 적용 + 매스 생성 1초 이내
- [ ] `GET /api/samples` 응답에 4~5개 샘플 + 썸네일 URL
- [ ] MassResultModal 에 "샘플: arquitectura" 배지 표시 (선택)

---

## 7. 회귀 테스트 (각 작업 완료 시)

```
[ ] 작업 [1] 후
   - assume_single_floorplan=True 호출 시 vLLM 호출 안 됨 (로그 확인)
   - arquitectura.dxf 도 단일 평면도로 처리 (bounds 자동 적용 X)
   - 처리 시간 60% 이상 단축

[ ] 작업 [2] 후
   - test_dataset1_coverage 80%+ 통과
   - dataset1_coverage.md 생성
   - 실패 케이스 분석 완료

[ ] 작업 [3] 후
   - 매스 생성 후 모달 자동 노출
   - Cesium 마커 (빨간 ● + 노란 ▬) 표시
   - 마커가 매스 인터랙션 (드래그/회전) 따라 함께 이동

[ ] 작업 [4] 후
   - "arquitectura" 라는 이름으로 사용자 업로드 시 bounds 적용 안 됨
   - 사이드바 샘플 카드 클릭 시 bounds 정상 적용
   - 일반 사용자 업로드 흐름은 sample_preset=None 그대로
   
[ ] 전체 통합
   - LOD1/2/3 동등성 (baseline 변화 없음)
   - 매스 인터랙션 정상
   - 일조분석/규정검토 영향 ±5% 이내
```

---

## 8. 일정

| 작업 | 시간 | 마일스톤 |
|---|---|---|
| [1] 단일 평면도 기본화 | 1~2h | v0.6 (5/4) 마감 |
| [2] 데이터셋1 검증 + LOD3 보강 | 3~5h | v0.6 |
| [3] 출입구/창문 모달 + 마커 | 3~4h | v1.0 (5/18) 초입 |
| [4] 샘플 분리 | 2~3h | v1.0 |

총 9~14시간. 5/18 까지 충분.

---

## 9. 시작 명령어 (호민님이 사용)

PC 에서:

```powershell
cd C:\Users\user\Desktop\26-1\building_cesium
.\backend\venv\Scripts\Activate.ps1
claude
```

Claude Code 첫 메시지 (그대로 복붙):

```
docs/lod/PHASE_H_single_focus_and_samples.md 와 docs/lod/CLAUDE.md 를 먼저 읽고,
작업 [1] 부터 [4] 까지 순서대로 진행해. 결정사항 (1번 섹션) 은 재논의 금지.

각 작업 완료 시:
1. DoD 체크리스트 결과 보고
2. 호민님 컨펌 후 다음 작업

특히 핵심:
- 작업 [1]: vLLM detect-floorplan 기본 skip (assume_single_floorplan=True)
- 작업 [2]: 데이터셋1 80%+ LOD3 Simple 정상 동작 (docs/lod/dataset1_coverage.md 생성)
- 작업 [3]: MassResultModal + Cesium 출입구/창문 마커
- 작업 [4]: sample_presets.py + 사이드바 샘플 카드, 파일명 자동 분기 제거

회귀 테스트 3종 (LOD1/2/3 동등성, 인터랙션, 검토 호환) 매 작업 완료 시 확인.
```

---

## 10. Cowork ↔ Claude Code 분담

이번 작업 중 Cowork 에서 처리할 일:
- 학과 AI 서버는 건드릴 일 없음 (vLLM 호출 skip 이라)
- 노션 회의록 갱신 (Phase H 완료 시)
- 진도표 v0.6 갱신
- EC2 배포 (git push + npm build)
- 회귀 테스트 결과 분석

Claude Code 단독:
- 백엔드 4개 작업 모든 코드
- 단위 테스트 작성/실행
- MassResultModal, useMassMarkers 신규 컴포넌트
- 데이터셋1 벌크 검증 실행

각 작업 끝나면 Cowork 으로 잠깐 들러서 진도/회의록 갱신 + 다음 작업 결정.

---

## 11. 부록 — 데이터셋1 에서 샘플 도면 선별 가이드

작업 [4] 의 SAMPLE_PRESETS 에 추가할 도면 선별 기준:

1. **단일 평면도** (다중 평면도 도면 제외)
2. **합리적 크기** (10~200m extent, 보통 주택/사무실)
3. **벽 레이어 명확** (외벽 LWPOLYLINE 또는 평행선 두 줄)
4. **문/창 레이어 분리** (분류기가 분류 가능한 명확한 레이어명)
5. **AI 분류 정확도 90%+** (예시: WALL, DOOR, WINDOW 같은 영어 표준 명명)

후보 (`데이터셋1-dxf/dxf/`):
- `14553569321165-1 Bed apartment plan.dxf` ✓
- `14524557351136-Student accomodation floor plan.dxf` ✓
- `1587601309OFFICE SPACE FLOOR PLAN (50' X53').dxf` ✓
- `1623589132Womans hostel with facade design-Ground Floor Plan.dxf` (확인 필요)
- `2bhk_german_style_house_ground_floor_plan_1.dxf` (확인 필요)

호민님이 PC 에서 각 도면을 한 번씩 LOD3 Simple 매스 생성해보고 정상 동작 확인된 3~5개를 최종 선정.
