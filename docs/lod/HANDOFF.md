# LOD 매스 작업 핸드오프 (Cowork → Claude Code)

> 호민님이 다른 Claude 와 함께 작성한 README.md 의 LOD2/3 업그레이드 계획을 Cowork 세션에서 코드와 대조 검증한 결과 + 실행 가이드. **Claude Code 는 이 문서부터 읽고 시작.**

작성: 2026-04-27, Cowork 세션 검토 결과 통합

---

## 0. 1분 요약 (Claude Code 시작 시 읽을 핵심)

- **계획서 (README.md) 의 코드 위치/시그니처/의존성 가정은 모두 정확** — 라인 번호까지 거의 일치 검증 완료
- **기술 결정 7개 (3D Boolean 회피, centerline 정규화, Y-up GLB, PBR 재사용, LOD enum, 한글 주석) 모두 합리적**
- **현재 LOD 파라미터는 코드에 없음** — 이번 작업에서 추가 예정 (예정대로)
- **가장 큰 리스크는 Phase 1 (벽 centerline 재구성)** — 데이터셋 다양성 때문. 폴백 필수
- **시연 임팩트 sweet spot 은 Phase 3** (LOD2.5 텍스처 개구부) — Phase 5 ROI 낮음
- **현재 프론트 `generateMass()` 가 wall_layers 를 안 보냄** (백엔드는 받음) — Phase 0 에서 함께 점검할 것

---

## 1. 코드 ↔ 계획서 일치 검증 결과

| 계획서 가정 | 실제 코드 | 결과 |
|---|---|---|
| `create_wall_building_gltf()` 라인 302~ | `backend/services/gltf_exporter.py:302-606` | ✅ 정확 |
| `_apply_pbr_material()` 헬퍼 | 라인 127-144 | ✅ |
| `[x, y, z] → [x, z, -y]` Y-up 변환 | 라인 568-573 (`np.column_stack(...)`) | ✅ |
| `/api/generate-mass` 라인 688~ | `backend/main.py:690-796` | ✅ 근사 |
| `MassGenerateRequest` 라인 48~ | `backend/api/models.py:48-84`, 이미 `wall_layers/file_id/wall_thickness` 필드 보유 | ✅ |
| `ai/src/pipeline.py`, `exporter.py` | 둘 다 존재 | ✅ |
| `GLBExporter.export_walls()` | `ai/src/exporter.py:43-100+` | ✅ |
| trimesh, shapely, ezdxf, mapbox-earcut | `backend/requirements.txt` 에 모두 있음 (trimesh==4.0.8, shapely==2.0.2, ezdxf==1.1.4, mapbox-earcut==1.0.2) | ✅ |
| `docs/ARCHITECTURE.md`, `MODULES.md` | 둘 다 존재 | ✅ |
| LOD 파라미터 enum | **현재 없음** (이번 작업에서 추가) | ⚠️ 예정대로 |

---

## 2. 핵심 리스크 3가지 + 대응

### 🚨 리스크 ① 벽 centerline 재구성이 **데이터 다양성**에 깨질 수 있음

**문제**: 데이터셋1 (~98개 도면) 에서 벽이 다음 케이스로 그려져 있음:
- 두 줄 평행선 (정상)
- 닫힌 LWPOLYLINE 한 번 (윤곽선)
- 두 줄인데 끝점이 어긋남 (CAD 작업자 실수)
- T-자/L-자 분기점에서 평행선 어긋남
- HATCH 로만 표현 (이미 detect 단계에서 제거되긴 함)

**대응 (필수)**:
- Phase 1 의 DoD 에 **정량 기준** 박기: "데이터셋1 의 N% 이상에서 centerline 추출 성공" (목표: 80%+)
- 추출 실패 시 → **무조건 LOD1 폴백**. LOD1 함수는 절대 건드리지 않으니 자연스럽게 폴백 가능
- API 응답에 `lod_actual` 필드 추가 — 사용자가 LOD2 요청해도 폴백되면 `1` 반환

### ⚠️ 리스크 ② 매스 인터랙션 (드래그/회전) 호환성

**문제**: 현재 LOD1 매스는 단일 mesh. LOD2/3 는 머티리얼별 multi-primitive GLB. Cesium 의 picking/anchor 가 깨질 수 있음.

**대응**:
- Phase 2 통합 직후 **회귀 테스트** — 매스 드래그/회전이 그대로 동작하는지
- 회전 anchor 는 **footprint 중심으로 통일** (LOD2 도 동일한 anchor)
- 드래그 hit-test 가 일부 primitive 만 잡으면 → glTF 의 root node 에 picking 가능한 invisible bounding mesh 추가 검토

### ⚠️ 리스크 ③ 일정 + Phase 5 ROI

**문제**: v1.1 (5/25) 까지 4주. Phase 5 (창틀/유리) 는 줌인 안 하면 시각 차이 미미.

**대응**:
- **Phase 3 까지를 졸업 데모 목표**로 잡기 (계획서 24번째 줄과 일치)
- Phase 5 는 보너스 — 시간 남으면. 안 하면 시연에서 안 티남.

---

## 3. 계획서 보완 사항 5가지 (계획서가 빠뜨렸거나 약한 것)

### ① 프론트엔드 LOD UI 작업이 어디 들어가는지 명확화 필요

`Sidebar.tsx` 매스 탭에 LOD 1/2/3 라디오/세그먼트 UI 추가가 어느 Phase 에 들어가는지 명시. 권장: **Phase 2 통합 시점에 03-integration.md 에서 함께**.

### ② 현재 프론트 `generateMass()` 가 wall_layers 를 안 보냄

`frontend/lib/api.ts:83-103` 의 `generateMass({footprint, height, floors, position?})` 시그니처에 wall_layers 가 빠져있음. 백엔드 (`MassGenerateRequest`) 는 이미 받는 구조. **Phase 0 에서 함께 점검**:
- `Sidebar.tsx` → `lib/api.ts` → `/api/generate-mass` 까지 wall_layers 흐름 일관성 확인
- 끊겨있다면 LOD 추가하기 전에 먼저 연결 (이전 task #31 에서 일부 처리됐다고 함, 재확인 필요)

### ③ Phase 별 회귀 테스트 셋

매 Phase 완료 시 다음 3가지 회귀 점검:

```
[ ] LOD1 동등성: 같은 입력으로 LOD1 결과 byte-equal (또는 mesh hash 동일)
[ ] 인터랙션: /editor 에서 매스 드래그/회전이 정상 동작 (수동 확인 OK)
[ ] 검토 호환: 일조분석 + 규정 검토 결과가 LOD1 대비 ±5% 이내
```

이 3가지가 깨지면 **머지 금지**.

### ④ 성능 벤치마크

LOD1 generate-mass 가 수백 ms 라면 LOD3 는 수 초까지 늘어날 수 있음. 시연에서 5초 이상 = UX 흠.

```
[Phase 0] LOD1 baseline 측정: arquitectura.dxf 에 대해 N회 실행 평균
[Phase 2] LOD2 측정 — baseline 의 3배 이내 목표
[Phase 4] LOD3 측정 — baseline 의 10배 이내 목표 (위반 시 최적화 또는 피처 컷)
```

### ⑤ Phase 0 의 5분 smoke test

trimesh 4.x 에서 `extrude_polygon` 이 mapbox-earcut 을 자동으로 사용하는지 의존성 동작 확인.

```python
# Phase 0 첫 액션 — 5초로 의존성 검증
import trimesh
import shapely.geometry as sg
poly = sg.Polygon([(0,0),(1,0),(1,1),(0,1)])
mesh = trimesh.creation.extrude_polygon(poly, height=3.0)
assert mesh.is_watertight, "단순 extrude 가 watertight 가 아니면 mapbox-earcut 미설치/오작동"
print("OK", mesh.vertices.shape)
```

---

## 4. Phase 0 (사전 준비) — Claude Code 가 즉시 실행할 작업

체크박스 따라 순서대로 진행:

```
[ ] 0.1  환경 의존성 smoke (5초)
         → backend venv 활성화
         → 위 ⑤ 의 trimesh + shapely + extrude_polygon 코드 1줄 실행

[ ] 0.2  새 모듈 디렉토리 + __init__.py
         → mkdir -p backend/services/lod
         → touch backend/services/lod/__init__.py

[ ] 0.3  LOD1 회귀 베이스라인 캡처
         → arquitectura.dxf 로 generate-mass 호출
         → 응답 GLB 의 mesh hash + vertex 수 + 처리 시간 기록
         → backend/services/lod/baseline_lod1.json 에 저장
         → 이후 매 Phase 에서 LOD1 동등성 검증 시 이 파일과 비교

[ ] 0.4  프론트 wall_layers 흐름 점검
         → Sidebar.tsx 매스 탭 → lib/api.ts:generateMass → /api/generate-mass
         → wall_layers 가 끝까지 전달되는지 확인
         → 끊겨있으면 (Phase 1 시작 전) 먼저 연결

[ ] 0.5  데이터 분류 케이스 샘플링
         → 데이터셋1 의 98개 DXF 중 무작위 5개 선정
         → 각각의 wall 엔티티가 (a) 평행선 두 줄 (b) 단일 LINE (c) LWPOLYLINE 중 어느 패턴인지 분류
         → backend/services/lod/dataset_patterns.md 에 기록
         → Phase 1 알고리즘 설계의 입력 분포 파악
```

---

## 5. Phase 1~5 권장 순서 (요약)

### Phase 1 — 벽 centerline 재구성 (LOD1.5)

**입력**: `wall_layers` (분류 결과)에 해당하는 DXF 엔티티들
**출력**: `List[(start_xy, end_xy, thickness)]` — centerline 정규화 모델
**핵심 알고리즘**:
1. 평행선 매칭 (방향 cos > 0.95, 거리 0.5~5m 범위) → 중점 + 두께 추출
2. LWPOLYLINE → 외곽선으로 처리 (centerline X — 두께를 외측 offset 으로 처리하거나 폴백)
3. 분기점 처리 — 단순한 케이스만 (Y-자, T-자) , 복잡 케이스는 LOD1 폴백

**DoD**:
- 데이터셋1 80% 이상에서 centerline 추출 성공
- 추출 실패 시 LOD1 폴백 자동
- 단위 테스트: 합성 도면 5개 (2줄/LWPOLYLINE/혼합/분기/실패케이스)

### Phase 2 — 슬래브 추가 (LOD2 인증)

벽 centerline 으로부터 닫힌 footprint 추출 → 바닥 슬래브 (두께 0.2m) + 평지붕 (두께 0.3m). PBR 머티리얼 분리.

**DoD**:
- 단일 primitive (LOD1) → 3 primitives (벽, 바닥, 지붕) glTF
- LOD1 결과와 footprint AABB 동일
- **회귀 테스트 3개 통과**: drag/rotate, 일조분석, 규정검토

### Phase 3 — 텍스처 개구부 (LOD2.5) ← **졸업 데모 sweet spot**

door/window 엔티티를 벽면에 매핑 → 벽면에 색칠된 사각형 (실제 구멍 X). PBR baseColorTexture 또는 baseColorFactor 만 다른 별도 primitive.

**DoD**:
- door 는 회색, window 는 하늘색/반투명
- 매핑 실패한 개구부는 무시 (warning 로그)

### Phase 4 — 실제 구멍 뚫기 (LOD3 진입)

벽 centerline 의 양면 surface 에 대해 **2D Shapely** 로 개구부 사각형 difference → `extrude_polygon`. 3D boolean 안 씀.

**DoD**:
- watertight mesh 유지
- 구멍 안쪽이 빈 공간으로 보임 (Cesium 에서)

### Phase 5 — 창틀/유리/문 디테일 (LOD3 마감, 보너스)

창틀 박스 (5cm 두께) + 반투명 유리 (alphaMode=BLEND). 문 패널 (열린 각도 옵션).

**경고**: Cesium 의 alphaMode=BLEND 는 깊이 정렬 이슈 있을 수 있음. 시연 직전 검증.

---

## 6. 권장 일정 (4주)

| 마일스톤 | 가능 범위 | 누구 |
|---|---|---|
| **v0.6 (5/4)** | Phase 0 + Phase 1 (단순 케이스만 + 폴백) | 신재훈 + 호민님 |
| **v1.0 (5/18)** | Phase 2 안정 + Phase 3 시작 | 같음 |
| **v1.1 (5/25)** | Phase 3 마감, Phase 4 시작 (Phase 5 는 보너스) | 같음 |

호민님 혼자 작업이라면 v1.0 까지 Phase 2 안정 + Phase 3 살짝 정도가 현실적.

---

## 7. CLAUDE.md (작업 규칙 요약 — 별도 파일도 있음)

전체 규칙은 `CLAUDE.md` 참고. 핵심:

1. **기존 LOD1 함수 절대 수정 금지** — 새 모듈 (`backend/services/lod/`) 에 추가만
2. **LOD enum 1/2/3** — API 계약에 박음. 부동소수 X
3. **모든 Phase 완료 시 회귀 테스트 3종 통과** (drag/rotate, 일조분석, 규정검토)
4. **한글 주석** — 함수/변수는 영어, docstring 과 인라인 주석은 한글
5. **PR 단위 = Phase 단위** — Phase 합쳐서 머지 금지
6. **Cowork 검증 완료 사항** (라인 번호, 의존성 등) 다시 의심하지 말 것 — 이 문서가 정답
7. **막히면 호민님과 합의 후 진행** — 임의로 결정 금지 (특히 LOD enum, 회전 anchor, 폴백 정책)

---

## 8. Claude Code 시작 명령어 (호민님이 사용)

```
# 호민님 PC 에서 Claude Code 켜기 전:
cd C:\Users\user\Desktop\26-1\building_cesium
# venv 활성화 (PowerShell)
.\backend\venv\Scripts\Activate.ps1
# Claude Code 진입
claude

# 첫 메시지 (그대로 복붙):
docs/lod/HANDOFF.md 와 docs/lod/CLAUDE.md 를 먼저 읽고,
Phase 0 부터 순서대로 진행해. 각 단계마다 결과 보고하고
호민님 컨펌 받은 후 다음으로.
```

---

## 9. Cowork (이 세션) ↔ Claude Code 분담

작업이 끝나면 다시 이 세션 (Cowork) 으로 돌아와 다음을 처리:

- **Cowork 가 잘 함**: 검증/회귀 테스트 작성, 노션 회의록 갱신, 진도표 업데이트, 커밋 메시지 정리, 학과 서버 배포
- **Claude Code 가 잘 함**: 빌드/실행/Cesium 시각 확인, 인터랙티브 디버깅, 본인 PC 의 git push, 학과 SSH 인터랙티브

각 Phase 완료 시점에 Cowork 로 돌아와 회귀 테스트 + 진도표 갱신 권장.
