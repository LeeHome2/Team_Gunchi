# CLAUDE.md — LOD 매스 작업 시 Claude Code 작업 규칙

> 이 디렉토리(`docs/lod/`) 의 작업을 진행할 때 따라야 할 규칙. 매 세션 시작 시 한 번 읽고 작업.
> HANDOFF.md 의 검증 결과 + 리스크 + Phase 액션 과 함께 본다.

---

## 0. 절대 규칙 (어기면 머지 금지)

### 🚫 기존 LOD1 함수 절대 수정 금지

다음 함수들은 **읽기만** 가능. 수정 시 즉시 revert.

- `backend/services/gltf_exporter.py:create_wall_building_gltf()` (라인 302~)
- `backend/services/gltf_exporter.py:_apply_pbr_material()` (라인 127~)
- `ai/src/exporter.py:GLBExporter.export_walls()` (라인 43~)

새 LOD2/3 코드는 **별도 모듈** (`backend/services/lod/`) 에 추가하고, 기존 코드는 LOD1 fallback 경로로 그대로 둔다.

### 🚫 3D Boolean 으로 개구부 처리 금지

개구부 (door/window) 는 **2D Shapely 의 `difference`** 로 구멍 뚫고 `extrude_polygon` 으로 압출. `trimesh.boolean` 은 Phase 5 디테일 (창틀/문 패널 등) 에서만, 그것도 `manifold3d` 엔진으로만.

### 🚫 LOD 파라미터를 부동소수로 받지 않기

`lod` 는 **정수 enum 1 | 2 | 3**. API 계약에 박음. `lod=2.5` 같은 값은 거부. (LOD2.5 표기는 내부 단계 명칭일 뿐, API 에는 노출 안 함)

### 🚫 좌표계 변환 규칙 변경 금지

GLB 출력 시 `[x, y, z] → [x, z, -y]` (Z-up → Y-up) 그대로. 경위도 변환은 GLB 생성 후 단계에서.

---

## 1. 작업 흐름 규칙

### Phase 단위 = PR 단위

한 Phase 가 끝나면 **PR 생성 → 호민님 리뷰 → 머지 → 다음 Phase**. Phase 합쳐서 머지하지 않는다.

각 PR 의 description 에는 다음 3개 회귀 테스트 결과 첨부:

```markdown
## 회귀 테스트 결과
- [ ] LOD1 동등성: arquitectura.dxf 로 LOD1 호출 결과가 baseline 과 일치
- [ ] 인터랙션: /editor 에서 매스 드래그/회전 정상 동작
- [ ] 검토 호환: 일조분석 + 규정검토 결과 LOD1 대비 ±5% 이내
```

3개 중 하나라도 실패하면 머지 금지.

### 임의 결정 금지

다음 사항들은 **반드시 호민님 컨펌**:
- LOD enum 의 의미 변경
- 회전 anchor 위치
- centerline 추출 실패 시 폴백 정책
- API 응답 스키마 변경 (특히 `lod_actual` 같은 신규 필드)
- 새 의존성 추가 (`requirements.txt` 수정)

확실하지 않으면 코드 작성 전 한 번 묻고 진행.

---

## 2. 코드 컨벤션

### 한글 주석

기존 코드 베이스 컨벤션 그대로:
- 함수명, 변수명, 클래스명: **영어**
- docstring, 인라인 주석: **한글**

```python
def reconstruct_centerline(entities: List[Entity]) -> List[Wall]:
    """벽 entity들에서 centerline 모델로 정규화.

    입력은 LINE 두 겹, LWPOLYLINE 단일, 혼합 케이스를 모두 다룬다.
    실패 시 빈 리스트 반환 → 호출자가 LOD1 fallback 결정.
    """
    # 1. 평행선 매칭 (방향 cos > 0.95, 거리 0.5~5m)
    pairs = match_parallel_lines(entities)
    ...
```

### 타입 힌트 필수

새로 추가하는 모든 함수는 타입 힌트 필수. Python 3.9+ 호환 (`Optional[T]`, `List[T]` 등 사용 — `T | None` PEP 604 문법은 학과 서버 Python 3.9 와 호환 안 됨).

### 파일 헤더

새 파일 시작에 docstring 으로 모듈 목적 한 단락:

```python
"""
LOD2 매스 생성 — 벽 centerline 모델 기반.

기존 LOD1 (gltf_exporter.create_wall_building_gltf) 와 별도로 동작.
실패 시 호출자 (main.py) 가 LOD1 으로 폴백한다.
"""
```

### 머티리얼 분리 = primitive 분리

LOD2/3 GLB 는 머티리얼별로 primitive 를 분리한다. `_apply_pbr_material()` 헬퍼 재사용:
- 벽: 흰색/베이지 (roughness 0.8)
- 슬래브: 회색 (roughness 0.9)
- 문: 갈색 (roughness 0.7)
- 창문: 하늘색 + alpha 0.5 (alphaMode=BLEND)
- 창틀: 짙은 회색

---

## 3. 테스트 규칙

### 단위 테스트 위치

- `backend/services/lod/test_*.py` — 새 LOD 모듈 테스트
- 기존 `backend/tests/` 와 분리해도 OK

### 테스트 데이터

- `ai/data/raw/` — 4개 DXF (스페인어 도면 + 1개)
- `frontend/public/samples/arquitectura.dxf` — 메인 회귀 픽스처
- 합성 도면: `backend/services/lod/fixtures/` 에 직접 ezdxf 로 만들 것 (단순 사각형, 평행선, T-자 등)

### Phase 별 테스트 의무

- **Phase 1**: 단위 테스트 5개 (2줄/LWPOLYLINE/혼합/분기/실패) + 데이터셋1 적용률 측정
- **Phase 2**: 단위 + LOD1 동등성 회귀
- **Phase 3**: 단위 + 매핑 실패 케이스 처리
- **Phase 4**: 단위 + watertight 검증 (`mesh.is_watertight`)
- **Phase 5**: 시각 회귀 (Cesium 스크린샷 비교는 어려우니 수동 검증 OK)

---

## 4. 의심하지 말 것 (Cowork 가 이미 검증함)

다음은 Cowork 세션에서 코드 직접 확인 완료. 다시 의심하지 말고 그대로 진행:

| 사실 | 출처 |
|---|---|
| `create_wall_building_gltf` 는 라인 302~606 에 있음 | Cowork 검증 |
| `_apply_pbr_material` 는 라인 127~144 에 있음 | Cowork 검증 |
| Y-up 변환 코드는 라인 568~573 에 있음 | Cowork 검증 |
| `MassGenerateRequest` 는 이미 `wall_layers/file_id/wall_thickness` 필드 보유 | Cowork 검증 |
| `trimesh==4.0.8`, `shapely==2.0.2`, `mapbox-earcut==1.0.2` 모두 설치됨 | Cowork 검증 |
| `ai/src/exporter.py:43` 에 `GLBExporter.export_walls` 존재 | Cowork 검증 |

---

## 5. 진행 보고 형식

각 Phase 의 작업 단계마다 호민님께 보고할 형식:

```
## Phase X.Y 완료

### 변경 사항
- file/path/added.py: 새 함수 abc()
- file/path/modified.py: 기존 함수에 lod 분기 추가

### 회귀 테스트
- LOD1 동등성: ✅ baseline 과 vertex_count, mesh_hash 일치
- 인터랙션: 🟡 수동 확인 필요 (호민님 PC 에서)
- 검토 호환: ✅ 일조 점수 차이 0.3% (±5% 이내)

### 다음 단계
- Phase X.Z: ...

### 막힌 점 / 의심
- (있으면 명시. 없으면 "없음")
```

---

## 6. 막힐 때 — 디버깅 우선순위

1. **Cowork 검증 완료 사항을 의심하지 말 것** (위 4번 표)
2. **stack trace 끝부분부터 읽기** — trimesh / shapely 의 오류는 입력 polygon 의 invalid geometry 가 원인인 경우 多
3. **`shapely.is_valid` + `shapely.make_valid`** 로 polygon 정합성 보장 후 extrude
4. **`trimesh.repair.fix_normals`, `mesh.is_watertight`** 로 mesh 정합성 검증
5. **모르겠으면 호민님 호출** — 임의 결정 금지

---

## 7. 다른 Cowork (이 디렉토리 외) 세션과의 협업

호민님이 작업 중에 다음과 같이 분담:

- **이 디렉토리 (`docs/lod/`) 작업**: Claude Code 단독 진행
- **나머지 (notion 회의록, 진도표 v0.6 갱신, 학과 서버 배포 등)**: Cowork 세션에서 처리
- **양쪽이 같은 파일을 동시에 만지지 않도록** 호민님이 조율 (한 번에 한쪽만 활성)

각 Phase 완료 후 호민님이 Cowork 세션으로 돌아가서 진도표 + 노션 회의록 갱신 진행 가능.

---

## 8. 출처

- `README.md` — 호민님이 다른 Claude 와 함께 만든 원본 계획
- `HANDOFF.md` — 이 작업 시작 시점 (2026-04-27) 의 Cowork 검증 결과 + Phase 0 액션
- 본 `CLAUDE.md` — 작업 규칙

세 파일 다 읽고 시작.
