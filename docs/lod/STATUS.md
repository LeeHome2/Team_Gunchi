# LOD 매스화 — 현재 진행 상태 (회의 설명용)

> 2026-04-29 기준. 내일 회의용. Phase 1~4 까지 진행, 통합 완료. 시연 가능 상태.

---

## 1. 한눈에 보기

```
[ 사용자가 매스 생성 버튼 클릭 ]
          │
          ▼
[ 프론트 frontend/lib/analysisApi.ts:generateModel(lod=N) ]
          │
          │ POST /api/generate-mass
          │ body: { footprint, height, file_id, wall_layers,
          │         lod, door_layers, window_layers, ... }
          ▼
[ 백엔드 backend/main.py:generate_mass() ]
          │
          ▼
   ┌──────┴────────┐
   │ lod 분기       │
   └──────┬────────┘
          ▼
   ┌──────────────────┬───────────────┬─────────────────┐
   │ lod=3            │ lod=2         │ lod=1           │
   │ (도면 + 색상)    │ (벽+슬래브)   │ (벽만, 기존)    │
   ▼                  ▼               ▼
build_lod3_simple  build_lod2     create_wall_building_gltf
   │                  │               │
   └──────────────────┴───────────────┘
          ▼
   [ glTF (.glb) 파일 생성 ]
          ▼
   [ 응답: model_url + lod_actual ]
          │
          ▼
   [ Cesium 뷰어가 GLB 로드 + 매스 표시 ]
```

**핵심 포인트**: 어느 LOD 가 요청되든 **실패 시 자동으로 더 낮은 LOD 로 폴백**, `lod_actual` 응답 필드로 사용자에게 알려줌.

---

## 2. LOD 1/2/3 단계별 무엇이 다른가

| 항목 | LOD1 (기존) | LOD2 (새로 추가) | LOD3 Simple (현재 적용) |
|---|---|---|---|
| 벽 메쉬 | LINE 마다 박스/quad | **벽 centerline + 두께로 압출** | LOD1 방식 (호환성 유지) |
| 바닥 슬래브 | 없음 | **두께 0.2m 슬래브** | 없음 |
| 평지붕 | 없음 | **두께 0.3m 슬래브** | 없음 |
| 문 표시 | 무시 | 무시 | **주황색 면 강조** |
| 창문 표시 | 무시 | 무시 | **하늘색 반투명 면** |
| 머티리얼 | 단색 | 벽/슬래브 PBR 분리 | 벽/문/창문 색상 분리 |
| 시각 효과 | 솔리드 박스 | 건물 같음 | **시연 임팩트 좋음** |

> **현재 시연 권장**: LOD3 Simple. LOD1 의 안정성 + 도면 분류 결과(문/창문)를 색상으로 보여줘 AI 분류가 잘 됐다는 것을 시각적으로 증명.

---

## 3. 핵심 알고리즘 4가지

### ① 벽 centerline 재구성 (`backend/services/lod/centerline.py`)

DXF 도면의 벽은 두 가지 형태로 그려져 있음:
- 평행선 두 줄 (외벽)
- 닫힌 LWPOLYLINE 한 번 (블록 윤곽)

이걸 **`(start, end, thickness)` 튜플로 정규화**하는 모듈.

```
[ 평행선 매칭 알고리즘 ]
1. 모든 LINE 의 방향 벡터 계산
2. 같은 방향(cos > 0.95) + 가까운 거리(0.5~5m) 쌍 찾기
3. 두 LINE 의 중점 → centerline
4. 두 LINE 사이 수직 거리 → wall thickness
5. 매칭 못한 LINE 은 default thickness=0.15m 로 단독 처리

[ LWPOLYLINE 처리 ]
- 닫힌 폴리곤 → WallLoop (외곽선 모드)
- 열린 폴리라인 → 각 세그먼트별 WallSegment

[ 결과 ]
CenterlineResult.success_rate >= 0.8 이면 LOD2/3 진행
미만이면 LOD1 폴백
```

**검증 결과** (단위 테스트 11개):
- 평행선 쌍 → centerline ✅
- LWPOLYLINE 닫힘/열림 ✅
- 혼합 케이스 ✅
- 실패 케이스 (빈 레이어, 잘못된 경로) ✅
- 실제 DXF (arquitectura.dxf, trabajo_final.dxf) ✅

### ② LOD2 슬래브 생성 (`lod2_builder.py`)

centerline 결과 → 닫힌 footprint 추출 → trimesh `extrude_polygon` 으로 압출.

```
1. 벽 centerline 들의 끝점들을 모아서 ConvexHull → 외곽
2. 외곽 footprint 를 0.2m 두께로 압출 → 바닥 슬래브
3. 같은 footprint 를 height 위치에서 0.3m 두께로 압출 → 지붕
4. 벽은 각 segment 를 thickness buffer 후 extrude
5. 머티리얼별로 primitive 분리:
   - 벽: 베이지 (220, 220, 210)
   - 바닥: 회색 (180, 180, 180)
   - 지붕: 진한 회색 (160, 160, 170)
6. multi-primitive GLB 조립 (Y-up 변환)
```

### ③ 개구부 추출 + 매핑 (`openings.py`)

문/창문 레이어에서 개구부 추출하고 **가장 가까운 벽**에 매핑.

```
[ Opening 추출 ]
- 문: ARC 엔티티 (호 모양으로 그려진 문 회전 표시) → 호의 반지름 = 문 폭
- 창문: 평행선 또는 사각형 → 중심점 + 폭 추출

[ 매핑 알고리즘 ]
1. 각 Opening 에 대해 모든 WallSegment 와 거리 계산
2. 가장 가까운 벽 1개 선택 (거리 < 0.5m)
3. 벽 시작점 기준 상대 위치 (0.0~1.0) 저장
4. 매핑 실패 (모든 벽에서 거리 > 0.5m) → 무시 + warning 로그
```

### ④ LOD3 Simple (현재 시연 권장 — `lod3_simple.py`)

**LOD2 의 복잡한 기하 처리 안 하고, LOD1 방식의 안정성 + 색상 강조로 임팩트만 추구**.

```
[ 입력 ]
- wall_layers: 벽 레이어 (회색)
- door_layers: 문 레이어 (주황색 반투명)
- window_layers: 창문 레이어 (하늘색 반투명)

[ 처리 ]
1. DXF 스케일 자동 감지 (mm/m/feet/축척도면 — extent 로 추론)
2. 각 레이어에서 LINE/LWPOLYLINE 추출
3. 각 선분을 수직 quad 로 변환 (LOD1 방식)
4. 머티리얼별로 다른 색상 적용 → primitive 분리
5. multi-primitive GLB 조립

[ DXF 스케일 자동 감지 로직 ]
- extent > 500: mm 단위 (× 0.001)
- extent 200~500: m 단위 가정
- extent 5~200: 합리적 m 단위
- extent 1~5: feet 단위 (× 0.3048)
- extent 0.1~1: 1:100 축척 도면 (× 100)
```

---

## 4. 데이터 흐름 + 폴백 체인

```
사용자 lod=3 요청
       │
       ▼
file_id 로 DXF 로드 + door_layers/window_layers 확인
       │
       ▼
       ┌─ 둘 다 있음? ──── YES → build_lod3_simple()
       │                          │
       │                       성공? ─ YES → 응답 (lod_actual=3)
       │                          │
       │                          NO ↓
       └─ NO ──────────────────────▼
                                   │
       centerline 재구성 + success_rate >= 0.8 ?
                                   │
                              YES ─┴─ NO
                              ▼      ▼
                          build_lod2  LOD1 폴백
                              │       │
                          성공? ─NO──→ │
                              │       │
                          YES ▼       ▼
                  응답 (lod_actual=2)  create_wall_building_gltf
                                      │
                                      ▼
                              응답 (lod_actual=1)
```

**원칙**: 어느 단계든 실패해도 사용자는 결과 GLB 를 항상 받음. 다만 lod_actual 로 "요청한 LOD 보다 떨어진 결과" 임을 알림.

---

## 5. 현재 통합 상태

| 통합 지점 | 파일 | 상태 |
|---|---|---|
| 백엔드 import | `backend/main.py:24` | ✅ `from services.lod import ...` |
| LOD 분기 | `backend/main.py:728~822` | ✅ lod=3/2/1 분기 + 자동 폴백 |
| 요청 모델 | `backend/api/models.py:86-97` | ✅ `lod`, `door_layers`, `window_layers` 필드 |
| 응답 모델 | `backend/api/models.py:130` | ✅ `lod_actual` 필드 |
| 프론트 호출 | `frontend/lib/analysisApi.ts:265, 334` | ✅ generateModel(lod=N, doorLayers, windowLayers) |
| 사용자 UI | (TODO) `Sidebar.tsx` | ⚠️ LOD 라디오 UI 미추가 — 코드는 호출 가능하나 UI 노출 X |

**현재 사용 방식**: 코드 레벨에서 lod 파라미터 전달은 가능하나 **사용자 UI 에 LOD 선택 라디오/세그먼트가 없음**. 시연 시:
- (a) 기본값 LOD3 으로 자동 호출하도록 백엔드 default 변경 (1줄 수정)
- (b) 또는 사용자가 LOD 를 명시적으로 선택할 수 있는 UI 추가

회의에서 결정할 사항 중 하나.

---

## 6. 단위 테스트 + 산출물

### 단위 테스트 (`backend/services/lod/test_*.py`)

| 테스트 파일 | 케이스 수 | 통과 |
|---|---|---|
| `test_centerline.py` | 11 (평행선/LWPOLYLINE/혼합/실패/실제 DXF) | ✅ 11/11 |
| `test_lod2.py` | (미확인 — Cowork sandbox mount stale) | 호민님 PC 에서 확인 |
| `test_lod3.py` | (미확인) | 호민님 PC 에서 확인 |

### 산출 GLB 파일

- `bench_lod1.glb`, `bench_lod2.glb` — 성능 벤치마크 비교용
- `test_lod2.glb`, `test_lod2_5.glb` — 단위 테스트 산출
- `baseline_lod1.json` — Phase 0 의 회귀 베이스라인

---

## 7. 알려진 제약/이슈 (회의에서 공유)

### A. arquitectura.dxf 의 다중 평면도 처리 (하드코딩)

`main.py:773-776` 에 특수 처리:

```python
if "arquitectura" in original_filename:
    lod3_bounds = {"min_x": -22, "max_x": -8, "min_y": 278, "max_y": 285}
```

이 도면은 **여러 평면도가 한 DXF 에 있어서** 좌상단 평면도1 만 자르는 범위를 하드코딩. 일반화하려면:
- AI 의 `detect_floorplan` (vLLM Vision) 결과의 bbox 를 main.py 가 직접 사용하도록 연결
- 현재는 ai_layer_classifier 의 detect 결과가 main.py 에 전달 안 되는 상태

### B. 사용자 UI 부재

LOD 선택 UI 가 사이드바 매스 탭에 없음. 회의 결정 사항.

### C. 회귀 테스트 3종 (수동 검증 필요)

- LOD1 동등성: ✅ (분기에서 LOD1 코드 안 건드림)
- 인터랙션 (드래그/회전): 🟡 호민님이 직접 /editor 에서 LOD3 매스 만든 후 드래그 회전 동작 확인 필요
- 검토 호환 (일조/규정): 🟡 LOD2/3 매스로 일조분석 + 규정검토 결과가 LOD1 대비 ±5% 이내인지 확인 필요

### D. Cesium alphaMode=BLEND 깊이 정렬

LOD3 Simple 에서 창문은 RGBA(0,180,255,180) 반투명. Cesium 1.114 에서 깊이 정렬 이슈가 있을 수 있음 — 시연 직전 확인 필요.

---

## 8. 앞으로 남은 일

### 단기 (이번 주, v0.6 마일스톤 5/4 까지)

- [ ] Sidebar.tsx 에 LOD 1/2/3 선택 UI (또는 LOD3 default 변경)
- [ ] 회귀 테스트 3종 (드래그/회전, 일조, 규정) 수동 검증
- [ ] arquitectura.dxf bounds 일반화 — detect_floorplan bbox 와 연결

### 중기 (v1.0, 5/18 까지)

- [ ] 진짜 LOD3 (`build_lod3` — 실제 구멍 뚫기) 안정화
- [ ] 데이터셋1 의 98개 도면에 대해 centerline 적용률 측정 (목표 80%+)
- [ ] Cesium alphaMode 정렬 이슈 해결

### 장기 (v1.1, 5/25 까지, 시간 남으면)

- [ ] 창틀/유리/문 패널 디테일
- [ ] 벽/지붕 텍스처 (PBR baseColorTexture)
- [ ] 다층 건물 (floors > 1) 지원

---

## 9. 회의에서 결정할 것

1. **시연용 default LOD** — LOD1 vs LOD3 Simple
2. **사용자 UI 에 LOD 선택지를 노출할지** (시연 임팩트 vs UX 단순성)
3. **arquitectura.dxf 하드코딩** 일반화 우선순위
4. **신재훈님과의 작업 분담** — 진짜 LOD3 (build_lod3) vs LOD3 Simple 중 어디에 시간 투자

---

## 10. 코드 위치 빠른 참조

```
backend/services/lod/
├── __init__.py           # 모든 심볼 export
├── wall_types.py         # WallSegment, WallLoop, CenterlineResult
├── centerline.py         # Phase 1: centerline 재구성
├── lod2_builder.py       # Phase 2/3: build_lod2, build_lod2_with_openings
├── openings.py           # Phase 3: 개구부 매핑
├── lod3_builder.py       # Phase 4: 진짜 LOD3 (실제 구멍)
├── lod3_simple.py        # Phase 4 Simple: LOD1 + 색상 (현재 시연용)
├── test_centerline.py    # Phase 1 단위 테스트 (11/11 통과)
├── test_lod2.py
└── test_lod3.py

backend/main.py:700-830        # generate-mass 엔드포인트 (LOD 분기)
backend/api/models.py:48-133   # MassGenerateRequest + Response
frontend/lib/analysisApi.ts    # generateModel(lod, ...)
docs/lod/                       # 본 문서들 (README, HANDOFF, CLAUDE, STATUS)
```
