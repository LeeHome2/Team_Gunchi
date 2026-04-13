# Building Cesium 데이터베이스 구조

## ERD (Entity Relationship Diagram)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CORE TABLES                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────┐                                                                │
│  │  users   │                                                                │
│  └────┬─────┘                                                                │
│       │ 1:N                                                                  │
│       ▼                                                                      │
│  ┌──────────┐      1:N      ┌──────────┐      1:N    ┌───────────────────┐  │
│  │ projects │──────────────→│dxf_files │────────────→│classification_    │  │
│  └──────────┘               └──────────┘             │     results       │  │
│       │                          │                   └───────────────────┘  │
│       │ 1:N                      │ 1:N                       │              │
│       ▼                          ▼                           │              │
│  ┌──────────────────────────────────────────┐                │              │
│  │            generated_models              │←───────────────┘              │
│  └──────────────────────────────────────────┘                               │
│       │                                                                      │
│       ├──────────────┬──────────────┐                                       │
│       │ 1:N          │ 1:N          │ 1:N                                   │
│       ▼              ▼              ▼                                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐                          │
│  │validation│  │sunlight_ │  │    placement_    │                          │
│  │_results  │  │analyses  │  │   optimizations  │                          │
│  └──────────┘  └──────────┘  └──────────────────┘                          │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                             ADMIN TABLES                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐  ┌─────────┐  ┌───────────────────┐                       │
│  │admin_accounts│  │api_keys │  │ ai_model_versions │                       │
│  └──────────────┘  └─────────┘  └───────────────────┘                       │
│                                                                              │
│  ┌───────────────────┐  ┌────────────────────┐  ┌─────────────────┐         │
│  │regulation_base_   │  │regulation_zone_    │  │service_settings │         │
│  │      rules        │  │      rules         │  │                 │         │
│  └───────────────────┘  └────────────────────┘  └─────────────────┘         │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 테이블 상세 (총 14개)

### Core Tables (7개)

#### 1. users (사용자)

| 컬럼 | 타입 | 제약조건 | 설명 |
|------|------|----------|------|
| id | UUID | PK | 사용자 고유 ID |
| name | String(100) | NOT NULL | 사용자 이름 |
| email | String(255) | NOT NULL, UNIQUE | 이메일 |
| password_hash | String(255) | - | 비밀번호 해시 |
| status | String(20) | NOT NULL, DEFAULT 'active' | active/pending/suspended |
| joined_at | DateTime | NOT NULL, DEFAULT now() | 가입일 |
| last_login_at | DateTime | - | 마지막 로그인 |
| project_count | Integer | NOT NULL, DEFAULT 0 | 프로젝트 수 |

**인덱스:**
- `idx_users_status` (status)
- `idx_users_joined` (joined_at)

**관계:**
- `projects` → 1:N → Project

---

#### 2. projects (프로젝트)

| 컬럼 | 타입 | 제약조건 | 설명 |
|------|------|----------|------|
| id | UUID | PK | 프로젝트 고유 ID |
| user_id | UUID | FK → users.id | 소유자 ID |
| name | String(255) | NOT NULL | 프로젝트명 |
| address | String(500) | - | 주소 |
| longitude | Float | - | 경도 |
| latitude | Float | - | 위도 |
| zone_type | String(100) | - | 용도지역 |
| state_data | JSON | - | 에디터 상태 저장 |
| created_at | DateTime | NOT NULL, DEFAULT now() | 생성일 |
| updated_at | DateTime | NOT NULL, DEFAULT now() | 수정일 |

**인덱스:**
- `idx_project_name` (name)
- `idx_project_created` (created_at)
- `idx_project_user` (user_id)

**관계:**
- `user` → N:1 → User
- `dxf_files` → 1:N → DxfFile (CASCADE)
- `generated_models` → 1:N → GeneratedModel (CASCADE)
- `validation_results` → 1:N → ValidationResult (CASCADE)
- `sunlight_analyses` → 1:N → SunlightAnalysis (CASCADE)
- `placement_optimizations` → 1:N → PlacementOptimization (CASCADE)

---

#### 3. dxf_files (DXF 파일)

| 컬럼 | 타입 | 제약조건 | 설명 |
|------|------|----------|------|
| id | UUID | PK | 파일 고유 ID |
| project_id | UUID | FK → projects.id, NOT NULL | 프로젝트 ID |
| original_filename | String(255) | NOT NULL | 원본 파일명 |
| stored_path | String(500) | NOT NULL | 저장 경로 |
| file_size | Integer | NOT NULL | 파일 크기 (bytes) |
| total_entities | Integer | - | 엔티티 수 |
| available_layers | JSON | - | 레이어 목록 |
| footprint | JSON | - | 대지 경계 좌표 |
| area_sqm | Float | - | 면적 (m²) |
| centroid | JSON | - | 중심점 [lon, lat] |
| bounds | JSON | - | 바운딩 박스 |
| uploaded_at | DateTime | NOT NULL, DEFAULT now() | 업로드일 |

**인덱스:**
- `idx_dxf_project` (project_id)
- `idx_dxf_uploaded` (uploaded_at)

---

#### 4. classification_results (AI 분류 결과)

| 컬럼 | 타입 | 제약조건 | 설명 |
|------|------|----------|------|
| id | UUID | PK | 결과 고유 ID |
| dxf_file_id | UUID | FK → dxf_files.id, NOT NULL | DXF 파일 ID |
| model_version | String(50) | NOT NULL | AI 모델 버전 (v2.1.0) |
| model_type | String(50) | NOT NULL | 모델 유형 |
| class_counts | JSON | NOT NULL | 분류별 카운트 |
| average_confidence | Float | NOT NULL | 평균 신뢰도 |
| total_entities | Integer | NOT NULL | 총 엔티티 수 |
| processing_time_ms | Integer | - | 처리 시간 (ms) |
| created_at | DateTime | NOT NULL, DEFAULT now() | 생성일 |

**class_counts 예시:**
```json
{
  "wall": 420,
  "door": 35,
  "window": 60,
  "column": 25
}
```

---

#### 5. generated_models (생성된 3D 모델)

| 컬럼 | 타입 | 제약조건 | 설명 |
|------|------|----------|------|
| id | UUID | PK | 모델 고유 ID |
| project_id | UUID | FK → projects.id, NOT NULL | 프로젝트 ID |
| dxf_file_id | UUID | FK → dxf_files.id | DXF 파일 ID |
| classification_id | UUID | FK → classification_results.id | 분류 결과 ID |
| model_type | String(50) | NOT NULL | mass / wall_mesh / full |
| file_path | String(500) | NOT NULL | GLB 파일 경로 |
| file_size | Integer | - | 파일 크기 (bytes) |
| height | Float | NOT NULL | 건물 높이 (m) |
| floors | Integer | NOT NULL | 층수 |
| created_at | DateTime | NOT NULL, DEFAULT now() | 생성일 |

---

#### 6. validation_results (규정 검토 결과)

| 컬럼 | 타입 | 제약조건 | 설명 |
|------|------|----------|------|
| id | UUID | PK | 결과 고유 ID |
| project_id | UUID | FK → projects.id, NOT NULL | 프로젝트 ID |
| model_id | UUID | FK → generated_models.id, NOT NULL | 모델 ID |
| is_valid | Boolean | NOT NULL | 적합 여부 |
| building_coverage | JSON | NOT NULL | 건폐율 결과 |
| setback | JSON | NOT NULL | 이격거리 결과 |
| height_check | JSON | NOT NULL | 높이제한 결과 |
| violations | JSON | NOT NULL | 위반 사항 목록 |
| zone_type | String(100) | - | 용도지역 |
| created_at | DateTime | NOT NULL, DEFAULT now() | 생성일 |

**building_coverage 예시:**
```json
{
  "value": 45.5,
  "limit": 60.0,
  "status": "pass"
}
```

**violations 예시:**
```json
[
  {"code": "COVERAGE_EXCEEDED", "message": "건폐율 60% 초과"}
]
```

---

#### 7. sunlight_analyses (일조 분석)

| 컬럼 | 타입 | 제약조건 | 설명 |
|------|------|----------|------|
| id | UUID | PK | 분석 고유 ID |
| project_id | UUID | FK → projects.id, NOT NULL | 프로젝트 ID |
| model_id | UUID | FK → generated_models.id | 모델 ID |
| analysis_date | Date | NOT NULL | 분석 기준일 |
| grid_spacing | Float | NOT NULL | 그리드 간격 (m) |
| total_points | Integer | NOT NULL | 분석 포인트 수 |
| avg_sunlight_hours | Float | NOT NULL | 평균 일조시간 |
| min_sunlight_hours | Float | NOT NULL | 최소 일조시간 |
| max_sunlight_hours | Float | NOT NULL | 최대 일조시간 |
| points_data | JSON | - | 포인트별 데이터 |
| created_at | DateTime | NOT NULL, DEFAULT now() | 생성일 |

---

#### 8. placement_optimizations (AI 배치 최적화)

| 컬럼 | 타입 | 제약조건 | 설명 |
|------|------|----------|------|
| id | UUID | PK | 최적화 고유 ID |
| project_id | UUID | FK → projects.id, NOT NULL | 프로젝트 ID |
| model_id | UUID | FK → generated_models.id, NOT NULL | 모델 ID |
| model_version | String(50) | NOT NULL | AI 모델 버전 |
| total_candidates_evaluated | Integer | NOT NULL | 평가된 후보 수 |
| computation_time_ms | Integer | - | 연산 시간 (ms) |
| candidates | JSON | NOT NULL | 후보 배치 목록 |
| weights | JSON | NOT NULL | 가중치 설정 |
| created_at | DateTime | NOT NULL, DEFAULT now() | 생성일 |

---

### Admin Tables (6개)

#### 9. admin_accounts (관리자 계정)

| 컬럼 | 타입 | 제약조건 | 설명 |
|------|------|----------|------|
| id | UUID | PK | 관리자 고유 ID |
| email | String(255) | NOT NULL, UNIQUE | 이메일 |
| name | String(100) | NOT NULL | 이름 |
| role | String(20) | NOT NULL, DEFAULT 'viewer' | superadmin/ops/viewer |
| is_active | Boolean | NOT NULL, DEFAULT true | 활성 상태 |
| last_login_at | DateTime | - | 마지막 로그인 |
| created_at | DateTime | NOT NULL, DEFAULT now() | 생성일 |

---

#### 10. api_keys (API 키)

| 컬럼 | 타입 | 제약조건 | 설명 |
|------|------|----------|------|
| id | UUID | PK | 키 고유 ID |
| name | String(100) | NOT NULL | 키 이름 |
| prefix | String(40) | NOT NULL | 키 프리픽스 (sk_live_xxxx) |
| key_hash | String(128) | - | 키 해시값 |
| environment | String(20) | NOT NULL, DEFAULT 'live' | live/test |
| is_active | Boolean | NOT NULL, DEFAULT true | 활성 상태 |
| created_at | DateTime | NOT NULL, DEFAULT now() | 생성일 |
| last_used_at | DateTime | - | 마지막 사용일 |

---

#### 11. ai_model_versions (AI 모델 버전)

| 컬럼 | 타입 | 제약조건 | 설명 |
|------|------|----------|------|
| id | UUID | PK | 모델 고유 ID |
| model_name | String(100) | NOT NULL | 모델명 |
| version | String(50) | NOT NULL | 버전 (v2.1.0) |
| model_type | String(50) | NOT NULL | 모델 유형 |
| is_active | Boolean | NOT NULL, DEFAULT false | 활성 상태 |
| accuracy | Float | - | 정확도 |
| file_path | String(500) | - | 모델 파일 경로 |
| description | Text | - | 설명 |
| trained_at | DateTime | - | 학습일 |
| created_at | DateTime | NOT NULL, DEFAULT now() | 생성일 |

---

#### 12. regulation_base_rules (기본 규정)

| 컬럼 | 타입 | 제약조건 | 설명 |
|------|------|----------|------|
| id | UUID | PK | 규정 고유 ID |
| key | String(40) | NOT NULL, UNIQUE | 키 (coverage, far 등) |
| label | String(100) | NOT NULL | 라벨 |
| unit | String(10) | NOT NULL | 단위 |
| value | Float | NOT NULL | 값 |
| description | Text | - | 설명 |
| updated_at | DateTime | NOT NULL, DEFAULT now() | 수정일 |

**예시 데이터:**
| key | label | unit | value |
|-----|-------|------|-------|
| coverage | 건폐율 | % | 60.0 |
| far | 용적률 | % | 200.0 |
| setback | 이격거리 | m | 1.5 |
| height_max | 최고높이 | m | 12.0 |

---

#### 13. regulation_zone_rules (지역별 규정)

| 컬럼 | 타입 | 제약조건 | 설명 |
|------|------|----------|------|
| id | UUID | PK | 규정 고유 ID |
| zone | String(100) | NOT NULL | 용도지역 |
| region | String(100) | NOT NULL | 적용지역 |
| coverage | Float | NOT NULL | 건폐율 (%) |
| far | Float | NOT NULL | 용적률 (%) |
| height_max | Float | NOT NULL | 최고높이 (m) |
| setback | Float | NOT NULL | 이격거리 (m) |
| updated_at | DateTime | NOT NULL, DEFAULT now() | 수정일 |

**예시 데이터:**
| zone | region | coverage | far | height_max | setback |
|------|--------|----------|-----|------------|---------|
| 제1종일반주거지역 | 서울특별시 전역 | 60.0 | 150.0 | 12.0 | 1.5 |
| 제2종일반주거지역 | 서울특별시 전역 | 60.0 | 200.0 | 15.0 | 1.5 |
| 일반상업지역 | 서울특별시 전역 | 80.0 | 800.0 | 40.0 | 1.0 |

---

#### 14. service_settings (서비스 설정)

| 컬럼 | 타입 | 제약조건 | 설명 |
|------|------|----------|------|
| key | String(80) | PK | 설정 키 |
| value | Text | NOT NULL | 설정 값 |
| updated_at | DateTime | NOT NULL, DEFAULT now() | 수정일 |

---

## 관계도 요약

```
users (1) ──────────────────→ (N) projects
projects (1) ───────────────→ (N) dxf_files
projects (1) ───────────────→ (N) generated_models
projects (1) ───────────────→ (N) validation_results
projects (1) ───────────────→ (N) sunlight_analyses
projects (1) ───────────────→ (N) placement_optimizations

dxf_files (1) ──────────────→ (N) classification_results
dxf_files (1) ──────────────→ (N) generated_models

classification_results (1) ─→ (N) generated_models

generated_models (1) ───────→ (N) validation_results
generated_models (1) ───────→ (N) sunlight_analyses
generated_models (1) ───────→ (N) placement_optimizations
```

---

## Cascade 삭제 규칙

| 부모 테이블 | 삭제 시 | 자식 테이블 |
|------------|---------|------------|
| users | SET NULL | projects.user_id |
| projects | CASCADE | dxf_files, generated_models, validation_results, sunlight_analyses, placement_optimizations |
| dxf_files | CASCADE | classification_results, generated_models |
| generated_models | CASCADE | validation_results, sunlight_analyses, placement_optimizations |

---

## 데이터베이스 설정

### 개발 환경 (SQLite)
```
backend/data/building.db
```

### 프로덕션 환경 (PostgreSQL)
```env
DATABASE_URL=postgresql://user:password@host:5432/database
```

---

## 마이그레이션

현재 SQLAlchemy의 `create_all()`을 사용하여 테이블을 자동 생성합니다.
앱 시작 시 `init_db()` 함수가 호출되어 누락된 테이블을 생성합니다.

```python
# backend/database/config.py
def init_db():
    Base.metadata.create_all(bind=engine)
```

**주의**: 컬럼 추가/수정은 자동으로 반영되지 않습니다.
프로덕션 환경에서는 Alembic 마이그레이션 도구 사용을 권장합니다.
