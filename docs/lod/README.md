# LOD2/3 매스 생성 업그레이드

> CAD 도면 파싱 단계는 wall/door/window까지 분류 완료. 현재 매스 생성은 외벽만 찍어내는 LOD1 수준. **목표: LOD2(슬래브 + 텍스처 개구부) → LOD3(실제 구멍 뚫린 개구부 + 창틀/유리)** 까지 단계적으로 끌어올린다.

---

## 0. 한 줄 요약

분류된 wall/door/window 엔티티 → 벽 centerline 재구성 → 개구부를 벽에 매핑 → 2D Shapely로 구멍 뚫고 압출 → 슬래브 추가 → (선택) 창틀/유리 디테일.

---

## 1. 현재 상태 vs 목표

| 항목 | 현재 (LOD1) | Phase 2 후 (LOD2) | Phase 4 후 (LOD3) |
|------|-------------|-------------------|-------------------|
| 벽 메시 | LINE마다 박스 또는 quad. 평행선 두 겹 | wall centerline 1개 + 두께 압출 | 동일 |
| 바닥/지붕 | 없음 | 평지붕 + 바닥 슬래브 | 동일 |
| 문 | 무시 | 벽면에 색칠된 사각형 | 실제 구멍 + 문 패널 |
| 창문 | 무시 | 벽면에 색칠된 사각형 | 실제 구멍 + 창틀 + 반투명 유리 |
| 머티리얼 | 단색 | 벽/슬래브/개구부 분리 | 벽/슬래브/창틀/유리 분리 |
| Cesium 시각 효과 | 솔리드 박스 | 건물처럼 보임 | 디테일 있는 건물 |

**끝까지 가지 않아도 OK**: Phase 2까지만 해도 시각적으로 완전히 다른 결과. 졸업 프로젝트 데모 기준 Phase 3 (텍스처 개구부)이면 충분.

---

## 2. 문서 인덱스

| 파일 | 내용 | 언제 보나 |
|------|------|----------|
| [`README.md`](./README.md) | 이 파일. 오리엔테이션 | 시작할 때 한 번 |
| [`HANDOFF.md`](./HANDOFF.md) | 검증 결과 + 리스크 + Phase 0 액션 (Cowork 검토 결과) | **첫 세션 진입 시 필독** |
| [`CLAUDE.md`](./CLAUDE.md) | Claude Code 작업 규칙 | 매 세션 시작 시 |
| [`01-spec.md`](./01-spec.md) | 기술 명세 (아키텍처, 데이터 계약, 알고리즘) | 코드 작성 전 반드시 (작성 예정) |
| [`02-phases.md`](./02-phases.md) | Phase별 작업 분해 (파일/함수/테스트/DoD) | 각 Phase 시작 시 (작성 예정) |
| [`03-integration.md`](./03-integration.md) | API/프론트엔드 통합 | Phase 2 완료 후 (작성 예정) |

---

## 3. 작업 영역 (어느 코드를 수정하는가)

이 프로젝트는 **두 개의 매스 생성 경로**가 있다. 둘 다 LOD1 수준이고, 이번 업그레이드는 **백엔드 경로**가 메인이고 AI 경로는 옵션이다.

```
[프론트엔드 매스 탭]
       │
       ↓
POST /api/generate-mass            ← 메인 작업 대상
  └─ backend/services/gltf_exporter.py
       └─ create_wall_building_gltf()  ← 여기를 갈아엎지 않고 LOD 경로 추가
                                       (LOD1 fallback 유지)

[CLI 오프라인 파이프라인]           ← 보조 작업
  └─ ai/src/pipeline.py
       └─ ai/src/exporter.py
            └─ GLBExporter.export_walls()  ← LOD2 메서드 추가
```

**원칙**: 기존 LOD1 함수는 절대 건드리지 않는다. LOD2/3는 별도 함수/모듈로 추가하고, API/프론트에서 LOD 파라미터로 분기.

---

## 4. 이미 결정된 사항 (재논의 금지)

작업 전에 호민님과 합의한 것들. Claude Code가 임의로 바꾸지 말 것.

1. **3D Boolean은 최후의 수단.** 개구부 처리는 2D Shapely로 구멍 뚫고 `extrude_polygon`으로 올린다. 3D `trimesh.boolean`은 Phase 5 디테일에서만 (그것도 `manifold3d` 엔진 한정).
2. **벽 centerline 모델로 통일.** 입력이 LINE 두 겹이든, 닫힌 LWPOLYLINE이든, 내부 표현은 `(start, end, thickness)` 튜플로 정규화.
3. **좌표계는 로컬 미터 단위.** 경위도 변환은 GLB 생성 후 단계에서 처리 (기존 패턴 유지).
4. **GLB는 Y-up.** 기존 `gltf_exporter.py`의 `[x, y, z] → [x, z, -y]` 변환 규칙 그대로 따른다.
5. **머티리얼은 PBR.** 기존 `_apply_pbr_material()` 헬퍼를 재사용. primitive를 분리해서 머티리얼별로 묶는다.
6. **LOD 파라미터는 정수 enum.** `1 | 2 | 3`. API 계약에 박는다.
7. **한글 주석 유지.** 함수명/변수명은 영어, docstring과 인라인 주석은 한글. 기존 코드 베이스 컨벤션.

---

## 5. Claude Code 빠른 시작

```bash
# 1. 환경 확인
cd backend && source venv/bin/activate
pip list | grep -E "trimesh|shapely|ezdxf|mapbox-earcut"
# 모두 있어야 함 (requirements.txt에 이미 있음 — Cowork 검증 완료)

# 2. 첫 작업: 새 모듈 디렉토리 생성
mkdir -p backend/services/lod
touch backend/services/lod/__init__.py

# 3. 테스트 픽스처 확인
ls ai/data/raw/   # 4개 DXF 파일 있음 (스페인어 도면 + 1개)
ls frontend/public/samples/   # arquitectura.dxf

# 4. HANDOFF.md 의 Phase 0 부터 순서대로 진행
```

**필독 순서**: [`HANDOFF.md`](./HANDOFF.md) → [`CLAUDE.md`](./CLAUDE.md) → 본 README → 다음 Phase 작업

---

## 6. 진행 상태 트래킹

각 Phase는 `02-phases.md` (작성 예정) 또는 HANDOFF.md 의 체크박스로 추적. PR 단위로 한 Phase 완료 → 체크 → 다음 Phase 진행.

```
[ ] Phase 0  사전 준비 (smoke 테스트, 폴더 생성, 회귀 베이스라인 캡처)
[ ] Phase 1  벽 centerline 재구성  (LOD1.5)
[ ] Phase 2  슬래브 추가             (LOD2 인증)
[ ] Phase 3  텍스처 개구부            (LOD2.5) ← 졸업 데모 sweet spot
[ ] Phase 4  실제 구멍 뚫기            (LOD3 진입)
[ ] Phase 5  창틀/유리/문 디테일       (LOD3 마감)
```

---

## 7. 참고

- 기존 아키텍처 문서: [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md)
- 기존 모듈 가이드: [`docs/MODULES.md`](../MODULES.md)
- 영향받는 핵심 파일 (Cowork 라인 번호 검증 완료):
  - `backend/services/gltf_exporter.py:302` (`create_wall_building_gltf`)
  - `backend/main.py:690` (`/api/generate-mass` 엔드포인트)
  - `backend/api/models.py:48` (`MassGenerateRequest`)
  - `ai/src/exporter.py:43` (`GLBExporter.export_walls`)
  - `frontend/components/Sidebar.tsx` (매스 탭)
  - `frontend/lib/api.ts:83` (`generateMass()` — 현재 wall_layers 미전달, 보강 필요)
