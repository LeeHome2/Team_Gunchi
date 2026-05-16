"""
CAD 기반 건축 매스 생성 시스템 - Backend (Cesium 버전)
"""

# IMPORTANT: load_dotenv() MUST run before importing any module that reads
# os.getenv at import time (e.g. database.config reads DATABASE_URL at import).
import os
from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, UploadFile, File, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import uuid
import shutil
from pathlib import Path
from typing import List, Tuple
from sqlalchemy.orm import Session
import logging
import httpx

from services.dxf_parser import parse_dxf_file
from services.gltf_exporter import create_building_gltf, create_wall_building_gltf
from services.lod import reconstruct_centerline, build_lod2, build_lod2_with_openings, build_lod3, build_lod3_simple
from services.lod.multi_floor import build_multi_floor_mass
from services.preprocess.manifest import load_manifest
from services.coordinate_transform import transform_coordinates
from api.models import (
    ProjectCreate,
    ProjectResponse,
    MassGenerateRequest,
    MassGenerateResponse,
    MultiFloorMassRequest,
    MultiFloorMassResponse,
    EntranceInfo,
    WindowFaceInfo,
    ValidationRequest,
    ValidationResponse,
    ParkingRequirementRequest,
    ParkingRequirementResponse,
    ParkingLayoutRequest,
    ParkingLayoutResponse,
    SignupRequest,
    LoginRequest,
    AuthResponse,
    AIScoringRequest,
    AIScoringResponse,
)
import hashlib
from database.config import get_db, init_db
from database import crud
from services import log_buffer
from api.admin_routes import router as admin_router

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
# Install ring-buffer handler so the admin console can tail logs in-app
log_buffer.install()
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Building Mass Generator API (Cesium)",
    description="CAD 도면 기반 3D 건물 매스 생성 및 일조 분석 API",
    version="1.0.0"
)

# CORS - 환경변수 기반 설정
# CORS_ORIGINS="*" (개발) 또는 "https://frontend.com,http://15.164.48.153:3000" (프로덕션)
cors_origins_env = os.getenv("CORS_ORIGINS", "*")
if cors_origins_env.strip() == "*":
    cors_origins = ["*"]
    cors_allow_credentials = False  # credentials 사용 시 wildcard 불가
else:
    cors_origins = [origin.strip() for origin in cors_origins_env.split(",") if origin.strip()]
    cors_allow_credentials = True

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=cors_allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)

logger.info(f"CORS allowed origins: {cors_origins}")

# Admin routes (/api/admin/*)
app.include_router(admin_router)

# 디렉토리 생성 (환경변수 오버라이드 가능, 기본값은 main.py 기준 절대 경로)
_BACKEND_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", str(_BACKEND_DIR / "uploads")))
MODELS_DIR = Path(os.getenv("MODELS_DIR", str(_BACKEND_DIR / "models")))
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
MODELS_DIR.mkdir(parents=True, exist_ok=True)
logger.info(f"Upload dir: {UPLOAD_DIR}")
logger.info(f"Models dir: {MODELS_DIR}")

# Static files for generated models
app.mount("/models", StaticFiles(directory=str(MODELS_DIR)), name="models")


# ============================================================================
# PROJECT CRUD ENDPOINTS
# ============================================================================


@app.post("/api/projects")
async def create_project_endpoint(
    request: ProjectCreate,
    db: Session = Depends(get_db)
):
    """
    프로젝트 생성

    DXF 업로드 전에 호출하여 project_id를 발급받습니다.
    이후 모든 API 호출에 이 project_id를 포함시킵니다.
    user_id가 제공되면 해당 사용자의 프로젝트로 생성됩니다.
    """
    try:
        import uuid as uuid_module
        user_uuid = None
        if request.user_id:
            user_uuid = uuid_module.UUID(request.user_id)

        project = crud.create_project(
            db=db,
            name=request.name,
            user_id=user_uuid,
            address=request.address,
        )
        return {
            "id": str(project.id),
            "user_id": str(project.user_id) if project.user_id else None,
            "name": project.name,
            "address": project.address,
            "status": "created",
            "created_at": project.created_at.isoformat() if project.created_at else None,
        }
    except Exception as e:
        logger.error(f"Failed to create project: {e}")
        raise HTTPException(status_code=500, detail=f"프로젝트 생성 실패: {str(e)}")


@app.get("/api/projects")
async def list_projects_endpoint(
    skip: int = 0,
    limit: int = 50,
    user_id: str = None,
    db: Session = Depends(get_db)
):
    """
    프로젝트 목록 조회

    user_id가 제공되면 해당 사용자의 프로젝트만 반환합니다.
    """
    try:
        import uuid as uuid_module
        user_uuid = None
        if user_id:
            user_uuid = uuid_module.UUID(user_id)

        projects = crud.get_all_projects(db, skip=skip, limit=limit, user_id=user_uuid)
        return {
            "projects": [
                {
                    "id": str(p.id),
                    "user_id": str(p.user_id) if p.user_id else None,
                    "name": p.name,
                    "address": p.address,
                    "zone_type": p.zone_type,
                    "created_at": p.created_at.isoformat() if p.created_at else None,
                    "updated_at": p.updated_at.isoformat() if p.updated_at else None,
                }
                for p in projects
            ],
            "total": len(projects),
        }
    except Exception as e:
        logger.error(f"Failed to list projects: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/projects/{project_id}")
async def get_project_endpoint(
    project_id: str,
    db: Session = Depends(get_db)
):
    """
    프로젝트 상세 조회

    관련된 DXF 파일, 분류 결과, 모델, 검토 결과를 모두 포함합니다.
    """
    try:
        import uuid as uuid_module
        project_uuid = uuid_module.UUID(project_id)
        project = crud.get_project(db, project_uuid)

        if not project:
            raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다")

        # Build response with related data
        dxf_files = [
            {
                "id": str(d.id),
                "original_filename": d.original_filename,
                "total_entities": d.total_entities,
                "area_sqm": d.area_sqm,
                "uploaded_at": d.uploaded_at.isoformat() if d.uploaded_at else None,
            }
            for d in project.dxf_files
        ]

        models = [
            {
                "id": str(m.id),
                "model_type": m.model_type,
                "file_path": m.file_path,
                "height": m.height,
                "floors": m.floors,
                "created_at": m.created_at.isoformat() if m.created_at else None,
            }
            for m in project.generated_models
        ]

        validations = [
            {
                "id": str(v.id),
                "is_valid": v.is_valid,
                "building_coverage": v.building_coverage,
                "setback": v.setback,
                "height_check": v.height_check,
                "violations": v.violations,
                "zone_type": v.zone_type,
                "created_at": v.created_at.isoformat() if v.created_at else None,
            }
            for v in project.validation_results
        ]

        return {
            "id": str(project.id),
            "name": project.name,
            "address": project.address,
            "zone_type": project.zone_type,
            "longitude": project.longitude,
            "latitude": project.latitude,
            "created_at": project.created_at.isoformat() if project.created_at else None,
            "dxf_files": dxf_files,
            "generated_models": models,
            "validation_results": validations,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get project {project_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.patch("/api/projects/{project_id}")
async def update_project_endpoint(
    project_id: str,
    payload: dict,
    db: Session = Depends(get_db)
):
    """프로젝트 정보 업데이트 (이름, 주소, 위치 등)"""
    try:
        import uuid as uuid_module
        project_uuid = uuid_module.UUID(project_id)

        allowed_fields = {'name', 'address', 'zone_type', 'longitude', 'latitude'}
        update_data = {k: v for k, v in payload.items() if k in allowed_fields}

        if not update_data:
            raise HTTPException(status_code=400, detail="업데이트할 필드가 없습니다")

        project = crud.update_project(db, project_uuid, **update_data)
        if not project:
            raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다")

        return {
            "id": str(project.id),
            "name": project.name,
            "address": project.address,
            "longitude": project.longitude,
            "latitude": project.latitude,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update project {project_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.put("/api/projects/{project_id}/state")
async def save_project_state(
    project_id: str,
    payload: dict,
    db: Session = Depends(get_db)
):
    """프로젝트 에디터 상태 전체 저장 (JSON)"""
    try:
        import uuid as uuid_module
        project_uuid = uuid_module.UUID(project_id)

        project = crud.update_project(db, project_uuid, state_data=payload)
        if not project:
            raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다")

        return {"success": True, "saved_at": project.updated_at.isoformat() if project.updated_at else None}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to save project state {project_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/projects/{project_id}/state")
async def load_project_state(
    project_id: str,
    db: Session = Depends(get_db)
):
    """프로젝트 에디터 상태 불러오기"""
    try:
        import uuid as uuid_module
        project_uuid = uuid_module.UUID(project_id)

        project = crud.get_project(db, project_uuid)
        if not project:
            raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다")

        if not project.state_data:
            raise HTTPException(status_code=404, detail="저장된 상태가 없습니다")

        return project.state_data
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to load project state {project_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/projects/{project_id}")
async def delete_project_endpoint(
    project_id: str,
    db: Session = Depends(get_db)
):
    """프로젝트 삭제 (관련 데이터 모두 cascade 삭제)"""
    try:
        import uuid as uuid_module
        project_uuid = uuid_module.UUID(project_id)
        success = crud.delete_project(db, project_uuid)

        if not success:
            raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다")

        return {"success": True, "message": "프로젝트가 삭제되었습니다"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete project {project_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# DATABASE INITIALIZATION
# ============================================================================

@app.on_event("startup")
async def startup_event():
    """Initialize database on startup"""
    try:
        init_db()
        logger.info("Database initialized successfully")

        # 간단 마이그레이션: state_data 컬럼이 없으면 추가 (SQLite + PostgreSQL 호환)
        try:
            from database.config import engine, DATABASE_URL
            import sqlalchemy
            _is_sqlite = DATABASE_URL.startswith("sqlite")
            with engine.connect() as conn:
                if _is_sqlite:
                    result = conn.execute(sqlalchemy.text("PRAGMA table_info(projects)"))
                    columns = [row[1] for row in result.fetchall()]
                    if 'state_data' not in columns:
                        conn.execute(sqlalchemy.text("ALTER TABLE projects ADD COLUMN state_data JSON"))
                        conn.commit()
                        logger.info("Added state_data column to projects table (SQLite)")
                else:
                    # PostgreSQL: ADD COLUMN IF NOT EXISTS
                    conn.execute(sqlalchemy.text(
                        "ALTER TABLE projects ADD COLUMN IF NOT EXISTS state_data JSON"
                    ))
                    conn.commit()
                    logger.info("Ensured state_data column exists (PostgreSQL)")
        except Exception as mig_err:
            logger.warning(f"Migration check failed: {mig_err}")

        # Seed default rows for the admin console (idempotent)
        try:
            from database.init_db import seed_if_enabled
            seed_if_enabled()
        except Exception as seed_err:
            logger.warning(f"Seed defaults failed: {seed_err}")

        # 재학습 스케줄러 시작
        try:
            from services.retrain_scheduler import init_retrain_scheduler
            from database.config import SessionLocal
            init_retrain_scheduler(SessionLocal)
            logger.info("Retrain scheduler started")
        except Exception as sched_err:
            logger.warning(f"Retrain scheduler init failed: {sched_err}")

    except Exception as e:
        logger.error(f"Failed to initialize database: {str(e)}")
        # Continue even if DB init fails - API can work without DB


@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown"""
    # 재학습 스케줄러 종료
    try:
        from services.retrain_scheduler import shutdown_retrain_scheduler
        shutdown_retrain_scheduler()
    except Exception:
        pass
    logger.info("Application shutting down")


@app.get("/")
async def root():
    """Root endpoint"""
    return {
        "message": "Building Mass Generator API (Cesium Version)",
        "version": "1.0.0",
        "docs": "/docs"
    }


@app.get("/api/regulations")
def get_public_regulations(db: Session = Depends(get_db)):
    """사용자용 규정 기준값 공개 엔드포인트.

    관리자가 /admin/regulations 에서 변경한 zone_rules / base_rules 를
    사용자 측 (CesiumViewer / editor/result 등) 에서 즉시 fetch 할 수 있도록
    노출. 관리자 변경 → 사용자 새로고침 즉시 반영.

    응답 형식 (간소화):
      {
        "zones": {
          "<zone_name>": {"coverage": 60, "setback": 1.5, "height_max": null, "far": 200},
          ...
        },
        "base": [{"key": ..., "value": ..., "unit": ...}, ...],
        "updated_at": <max updated_at iso>
      }
    """
    try:
        zones = crud.list_zone_rules(db)
        base = crud.list_base_rules(db)

        zone_dict = {}
        max_updated = None
        for r in zones:
            # 같은 zone 에 region 별 여러 rule 이 있으면 첫 번째(가장 일반) 사용
            # 더 정교하게는 region 별로 nested 구조 가능
            if r.zone not in zone_dict:
                zone_dict[r.zone] = {
                    "coverage": r.coverage,
                    "setback": r.setback,
                    "setback_road": getattr(r, 'setback_road', 1.0),
                    "setback_adjacent": getattr(r, 'setback_adjacent', 0.5),
                    "height_max": r.height_max,
                    "far": r.far,
                }
            if r.updated_at and (max_updated is None or r.updated_at > max_updated):
                max_updated = r.updated_at

        base_list = [
            {
                "key": r.key,
                "label": r.label,
                "unit": r.unit,
                "value": r.value,
            }
            for r in base
        ]
        for r in base:
            if r.updated_at and (max_updated is None or r.updated_at > max_updated):
                max_updated = r.updated_at

        return {
            "zones": zone_dict,
            "base": base_list,
            "updated_at": max_updated.isoformat() if max_updated else None,
        }
    except Exception as e:
        logger.error(f"규정 조회 실패: {e}")
        return {"zones": {}, "base": [], "updated_at": None, "error": str(e)}


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy"}


# ============================================================================
# AUTH ENDPOINTS
# ============================================================================

def hash_password(password: str) -> str:
    """Simple password hashing (use bcrypt in production)"""
    return hashlib.sha256(password.encode()).hexdigest()


@app.post("/api/auth/signup", response_model=AuthResponse)
async def signup(request: SignupRequest, db: Session = Depends(get_db)):
    """
    회원가입

    새 사용자 계정을 생성합니다.
    """
    try:
        # Check if email already exists
        existing_user = crud.get_user_by_email(db, request.email)
        if existing_user:
            return AuthResponse(
                success=False,
                message="이미 등록된 이메일입니다"
            )

        # Create new user
        password_hash = hash_password(request.password)
        user = crud.create_user(
            db=db,
            name=request.name,
            email=request.email,
            password_hash=password_hash,
            status="active"
        )

        logger.info(f"New user registered: {user.email}")
        return AuthResponse(
            success=True,
            user_id=str(user.id),
            name=user.name,
            email=user.email,
            message="회원가입이 완료되었습니다"
        )
    except Exception as e:
        logger.error(f"Signup failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/auth/login", response_model=AuthResponse)
async def login(request: LoginRequest, db: Session = Depends(get_db)):
    """
    로그인

    이메일과 비밀번호로 로그인합니다.
    """
    try:
        user = crud.get_user_by_email(db, request.email)

        if not user:
            return AuthResponse(
                success=False,
                message="등록되지 않은 이메일입니다"
            )

        # Check password
        password_hash = hash_password(request.password)
        if user.password_hash != password_hash:
            return AuthResponse(
                success=False,
                message="비밀번호가 일치하지 않습니다"
            )

        # Check status
        if user.status != "active":
            return AuthResponse(
                success=False,
                message=f"계정이 {user.status} 상태입니다"
            )

        # Update last login
        from datetime import datetime
        user.last_login_at = datetime.utcnow()
        db.commit()

        logger.info(f"User logged in: {user.email}")
        return AuthResponse(
            success=True,
            user_id=str(user.id),
            name=user.name,
            email=user.email,
            message="로그인 성공"
        )
    except Exception as e:
        logger.error(f"Login failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/auth/me")
async def get_current_user(user_id: str, db: Session = Depends(get_db)):
    """
    현재 사용자 정보 조회
    """
    try:
        import uuid as uuid_module
        user_uuid = uuid_module.UUID(user_id)
        user = crud.get_user(db, user_uuid)

        if not user:
            raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")

        return {
            "id": str(user.id),
            "name": user.name,
            "email": user.email,
            "status": user.status,
            "project_count": user.project_count,
            "joined_at": user.joined_at.isoformat() if user.joined_at else None,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Get user failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ─── DXF 분류 미리보기 API ─────────────────────────────────────
@app.get("/api/dxf-preview/{file_id}")
async def get_dxf_classification_preview(
    file_id: str,
    wall_layers: str = "",  # 쉼표로 구분된 레이어 이름
    door_layers: str = "",
    window_layers: str = "",
):
    """
    DXF 파일의 분류 결과를 4색 이미지로 반환.
    벽=검정, 문=주황, 창문=하늘, 기타=회색
    """
    from fastapi.responses import FileResponse
    from services.preprocess.visualizer import render_overlay_4color
    import tempfile

    dxf_path = UPLOAD_DIR / f"{file_id}.dxf"
    if not dxf_path.exists():
        raise HTTPException(status_code=404, detail=f"DXF 파일을 찾을 수 없습니다: {file_id}")

    # 쉼표로 구분된 레이어 파싱
    wall_list = [l.strip() for l in wall_layers.split(",") if l.strip()]
    door_list = [l.strip() for l in door_layers.split(",") if l.strip()]
    window_list = [l.strip() for l in window_layers.split(",") if l.strip()]

    # 실제 DXF 레이어 추출
    import ezdxf
    doc = ezdxf.readfile(str(dxf_path))
    msp = doc.modelspace()
    actual_layers = set()
    for ent in msp:
        try:
            actual_layers.add(ent.dxf.layer)
        except:
            pass

    # 제공된 레이어가 실제 존재하는지 검증
    wall_matched = [l for l in wall_list if l in actual_layers]
    door_matched = [l for l in door_list if l in actual_layers]
    window_matched = [l for l in window_list if l in actual_layers]

    # 일치하는 레이어가 없으면 자동 감지
    WALL_KEYWORDS = ['wall', 'muro', 'muros', 'medianera', 'viga', '벽']
    DOOR_KEYWORDS = ['door', 'puerta', 'puertas', '문']
    WINDOW_KEYWORDS = ['window', 'ventana', 'ventanas', '창']

    if not wall_matched:
        wall_matched = [l for l in actual_layers if any(kw in l.lower() for kw in WALL_KEYWORDS)]
    if not door_matched:
        door_matched = [l for l in actual_layers if any(kw in l.lower() for kw in DOOR_KEYWORDS)]
    if not window_matched:
        window_matched = [l for l in actual_layers if any(kw in l.lower() for kw in WINDOW_KEYWORDS)]

    # layer_decisions 구성
    layer_decisions = {}
    for layer in wall_matched:
        layer_decisions[layer] = "wall"
    for layer in door_matched:
        layer_decisions[layer] = "door"
    for layer in window_matched:
        layer_decisions[layer] = "window"

    # 나머지 레이어는 other
    for layer in actual_layers:
        if layer not in layer_decisions:
            layer_decisions[layer] = "other"

    # 로깅
    wall_count = sum(1 for v in layer_decisions.values() if v == "wall")
    door_count = sum(1 for v in layer_decisions.values() if v == "door")
    window_count = sum(1 for v in layer_decisions.values() if v == "window")
    logger.info(f"Preview layer detection: wall={wall_count}, door={door_count}, window={window_count}")

    # 임시 파일에 렌더링
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        output_path = Path(tmp.name)

    try:
        render_overlay_4color(dxf_path, layer_decisions, output_path, figsize=(10, 10), dpi=80)
        return FileResponse(
            output_path,
            media_type="image/png",
            filename=f"preview_{file_id}.png",
            background=None,  # 동기적으로 전송 후 삭제
        )
    except Exception as e:
        logger.error(f"Preview rendering failed: {e}")
        raise HTTPException(status_code=500, detail=f"미리보기 생성 실패: {e}")


@app.post("/api/upload-dxf")
async def upload_dxf(
    file: UploadFile = File(...),
    project_id: str = None,
    db: Session = Depends(get_db)
):
    """
    DXF 파일 업로드 및 파싱

    Args:
        file: DXF 파일
        project_id: (Optional) 프로젝트 ID for database storage

    Returns:
        파싱된 대지 정보 (footprint, 면적, 중심점)
    """
    if not file.filename.lower().endswith('.dxf'):
        raise HTTPException(status_code=400, detail="DXF 파일만 업로드 가능합니다")

    # 파일 저장
    file_id = str(uuid.uuid4())
    file_path = UPLOAD_DIR / f"{file_id}.dxf"

    try:
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        # DXF 파싱
        result = parse_dxf_file(str(file_path))

        if not result["success"]:
            raise HTTPException(status_code=400, detail=result.get("error", "파싱 실패"))

        # Save to database if project_id provided
        dxf_record = None
        if project_id:
            try:
                import uuid as uuid_module
                project_uuid = uuid_module.UUID(project_id)

                # Check for existing DXF with same filename (deduplication)
                existing_dxf = crud.get_dxf_by_filename(db, project_uuid, file.filename)
                if existing_dxf:
                    # Delete existing record first (cascade deletes related models)
                    crud.delete_dxf_file(db, existing_dxf.id)
                    logger.info(f"Replaced existing DXF '{file.filename}' in project {project_id}")

                dxf_record = crud.create_dxf_file(
                    db=db,
                    project_id=project_uuid,
                    original_filename=file.filename,
                    stored_path=str(file_path),
                    file_size=file_path.stat().st_size if file_path.exists() else 0,
                    total_entities=result.get("total_entities"),
                    available_layers=result.get("available_layers") or result.get("layers"),
                    footprint=result.get("footprint"),
                    area_sqm=result.get("area"),
                    centroid=result.get("centroid"),
                    bounds=result.get("bounds"),
                    id=uuid_module.UUID(file_id)  # Use disk file UUID as DB record ID
                )
                logger.info(f"DXF file {file_id} saved to database with project {project_id}")
            except Exception as e:
                logger.warning(f"Failed to save DXF record to database: {str(e)}")
                # Continue without DB - API still works

        return {
            "success": True,
            "file_id": file_id,
            "db_record_id": str(dxf_record.id) if dxf_record else None,
            "site": {
                "footprint": result["footprint"],
                "area_sqm": result["area"],
                "centroid": result["centroid"],
                "bounds": result["bounds"]
            },
            "total_entities": result.get("total_entities", 0),
            "entities": result.get("entities", []),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error uploading DXF: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# ─── 평면도 검출 헬퍼 함수 ─────────────────────────────────────
async def call_detect_floorplan(dxf_path: Path, timeout: float = 120.0) -> dict:
    """
    학과 AI 서버 /api/detect-floorplan 호출하여 평면도 bbox 검출.

    Returns:
        {
            "floorplans_found": bool,
            "floorplans": [{"label": "1F", "floor_index": 0, "bbox": {"x_min", "y_min", "x_max", "y_max"}}, ...],
            "extent_dxf": {"min_x", "min_y", "max_x", "max_y"}
        }
    """
    ai_server_url = os.getenv("AI_SERVER_URL", "http://localhost:8001")
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            with open(dxf_path, "rb") as f:
                response = await client.post(
                    f"{ai_server_url}/api/detect-floorplan",
                    files={"file": (dxf_path.name, f, "application/octet-stream")},
                )
                response.raise_for_status()
                return response.json()
    except Exception as e:
        logger.warning(f"detect-floorplan API 호출 실패: {e}")
        return {"floorplans_found": False, "floorplans": [], "extent_dxf": None}


def convert_bbox_to_dxf_coords(bbox: dict, extent: dict) -> dict:
    """
    정규화된 bbox (0~1)를 실제 DXF 좌표로 변환.

    Args:
        bbox: {"x_min": 0.1, "y_min": 0.2, "x_max": 0.8, "y_max": 0.9}
        extent: {"min_x": -20, "min_y": 260, "max_x": 30, "max_y": 290}

    Returns:
        {"min_x": ..., "min_y": ..., "max_x": ..., "max_y": ...}
    """
    width = extent["max_x"] - extent["min_x"]
    height = extent["max_y"] - extent["min_y"]

    return {
        "min_x": extent["min_x"] + bbox["x_min"] * width,
        "max_x": extent["min_x"] + bbox["x_max"] * width,
        "min_y": extent["min_y"] + bbox["y_min"] * height,
        "max_y": extent["min_y"] + bbox["y_max"] * height,
    }


def compute_dxf_extent_local(dxf_path: Path, wall_layers: list = None) -> dict:
    """
    로컬 DXF 파일에서 좌표 범위 계산.

    wall_layers가 주어지면 해당 레이어의 엔티티만 사용하여 범위 계산.
    (여러 도면이 있는 DXF에서 벽 레이어 기준으로 정확한 평면도 영역 찾기)
    """
    import ezdxf

    doc = ezdxf.readfile(str(dxf_path))
    msp = doc.modelspace()

    xs, ys = [], []

    # wall_layers가 있으면 해당 레이어만, 없으면 전체
    wall_layers_upper = [l.upper() for l in (wall_layers or [])]

    for ent in msp:
        try:
            # wall_layers 필터링
            if wall_layers_upper:
                layer = ent.dxf.layer.upper()
                if not any(wl in layer for wl in wall_layers_upper):
                    continue

            et = ent.dxftype()
            if et == "LINE":
                xs.extend([ent.dxf.start[0], ent.dxf.end[0]])
                ys.extend([ent.dxf.start[1], ent.dxf.end[1]])
            elif et == "LWPOLYLINE":
                for x, y, *_ in ent.get_points():
                    xs.append(x)
                    ys.append(y)
            elif et == "POLYLINE":
                for v in ent.vertices:
                    xs.append(v.dxf.location[0])
                    ys.append(v.dxf.location[1])
            elif et == "CIRCLE":
                cx, cy = ent.dxf.center[:2]
                r = ent.dxf.radius
                xs.extend([cx - r, cx + r])
                ys.extend([cy - r, cy + r])
            elif et == "ARC":
                cx, cy = ent.dxf.center[:2]
                r = ent.dxf.radius
                xs.extend([cx - r, cx + r])
                ys.extend([cy - r, cy + r])
        except Exception:
            continue

    if not xs or not ys:
        return {"min_x": 0, "min_y": 0, "max_x": 1, "max_y": 1}

    return {
        "min_x": min(xs),
        "min_y": min(ys),
        "max_x": max(xs),
        "max_y": max(ys),
    }


@app.post("/api/generate-mass", response_model=MassGenerateResponse)
async def generate_mass(
    request: MassGenerateRequest,
    project_id: str = None,
    dxf_file_id: str = None,
    db: Session = Depends(get_db)
):
    """
    3D 건물 매스 glTF 생성

    Args:
        footprint: 건물 바닥면 좌표 [[lon, lat], ...] (경위도)
        height: 건물 높이 (m)
        floors: 층수
        position: 배치 위치 (longitude, latitude)
        project_id: (Optional) 프로젝트 ID for database storage
        dxf_file_id: (Optional) DXF 파일 ID for linking

    Returns:
        생성된 glTF 모델 URL
    """
    import numpy as np

    try:
        model_id = str(uuid.uuid4())
        model_path = MODELS_DIR / f"{model_id}.glb"

        # === 벽 레이어 기반 생성 vs 단순 footprint 생성 ===
        # v1.0: 항상 LOD3 사용 (request.lod 무시)
        lod_requested = 3
        lod_actual = 3

        if request.wall_layers and request.file_id:
            # 벽체 기반: DXF에서 벽 레이어 추출 → 벽 형태 GLB
            dxf_path = UPLOAD_DIR / f"{request.file_id}.dxf"
            if not dxf_path.exists():
                raise HTTPException(status_code=404, detail=f"DXF 파일을 찾을 수 없습니다: {request.file_id}")

            # ─── 레이어 검증 및 자동 감지 ─────────────────────────────
            # 프론트엔드에서 보낸 레이어가 실제 DXF에 존재하는지 검증
            # 존재하지 않으면 키워드 기반으로 벽 레이어 자동 감지
            import ezdxf
            doc = ezdxf.readfile(str(dxf_path))
            msp = doc.modelspace()

            # 실제 DXF 레이어 추출
            actual_layers = set()
            for ent in msp:
                try:
                    actual_layers.add(ent.dxf.layer)
                except:
                    pass

            # 프론트엔드 레이어가 실제 존재하는지 확인
            requested_wall_layers = request.wall_layers
            matched_layers = [l for l in requested_wall_layers if l in actual_layers]

            if len(matched_layers) == 0:
                logger.warning(f"프론트엔드 레이어 불일치! 요청: {requested_wall_layers[:5]}, 실제: {list(actual_layers)[:10]}")

                # 키워드 기반 벽 레이어 자동 감지
                WALL_KEYWORDS = ['wall', 'muro', 'muros', 'medianera', 'viga', 'cuadro', '벽', '외벽', '내벽', 'struct']
                detected_wall_layers = []
                for layer in actual_layers:
                    layer_lower = layer.lower()
                    if any(kw in layer_lower for kw in WALL_KEYWORDS):
                        detected_wall_layers.append(layer)

                if detected_wall_layers:
                    logger.info(f"벽 레이어 자동 감지: {detected_wall_layers}")
                    request.wall_layers = detected_wall_layers
                else:
                    logger.warning(f"벽 레이어를 자동 감지할 수 없음. 실제 레이어: {list(actual_layers)[:15]}")
            else:
                logger.info(f"레이어 일치 확인: {matched_layers}")
                request.wall_layers = matched_layers  # 일치하는 레이어만 사용

            # 문/창문 레이어도 검증
            if request.door_layers:
                matched_door = [l for l in request.door_layers if l in actual_layers]
                if not matched_door:
                    DOOR_KEYWORDS = ['door', 'puerta', 'puertas', '문', '출입']
                    detected_doors = [l for l in actual_layers if any(kw in l.lower() for kw in DOOR_KEYWORDS)]
                    if detected_doors:
                        logger.info(f"문 레이어 자동 감지: {detected_doors}")
                        request.door_layers = detected_doors
                else:
                    request.door_layers = matched_door

            if request.window_layers:
                matched_window = [l for l in request.window_layers if l in actual_layers]
                if not matched_window:
                    WINDOW_KEYWORDS = ['window', 'ventana', 'ventanas', '창']
                    detected_windows = [l for l in actual_layers if any(kw in l.lower() for kw in WINDOW_KEYWORDS)]
                    if detected_windows:
                        logger.info(f"창문 레이어 자동 감지: {detected_windows}")
                        request.window_layers = detected_windows
                else:
                    request.window_layers = matched_window
            # ─── 레이어 검증 완료 ─────────────────────────────────────

            logger.info(f"Wall-based generation: LOD={lod_requested}, layers={request.wall_layers}, thickness={request.wall_thickness}m")

            # ★ v1.0: 항상 LOD3 Simple 사용 (단일 평면도 모드)
            wall_result = None
            build_steps = []
            openings_data = []  # 문/창문 위치 (Cesium 마커용)
            lod3_bounds = None  # 단일 평면도 모드 — 전체 DXF 사용, detect-floorplan skip
            glb_url_no_roof = None  # 천장 없는 버전 URL

            logger.info(f"LOD3 Simple 생성 시작: wall={request.wall_layers}, door={request.door_layers}, window={request.window_layers}")

            # LOD3 Simple 매스 생성 (천장 포함)
            lod_result = build_lod3_simple(
                str(dxf_path),
                request.wall_layers,
                request.door_layers or [],  # 문 레이어 없으면 빈 리스트
                request.window_layers or [],  # 창문 레이어 없으면 빈 리스트
                height=request.height,
                output_path=str(model_path),
                bounds=lod3_bounds,
                include_roof=True
            )
            if lod_result:
                wall_result = lod_result
                build_steps = lod_result.get("steps", [])
                openings_data = lod_result.get("openings", [])  # 문/창문 위치
                lod_actual = 3
                logger.info(f"LOD3 Simple 생성 성공 (천장 포함): {lod_result['mesh_stats']}, openings={len(openings_data)}개")

                # ★ 천장 없는 버전도 생성
                model_path_no_roof = MODELS_DIR / f"{model_id}_no_roof.glb"
                lod_result_no_roof = build_lod3_simple(
                    str(dxf_path),
                    request.wall_layers,
                    request.door_layers or [],
                    request.window_layers or [],
                    height=request.height,
                    output_path=str(model_path_no_roof),
                    bounds=lod3_bounds,
                    include_roof=False
                )
                if lod_result_no_roof:
                    glb_url_no_roof = f"/models/{model_id}_no_roof.glb"
                    logger.info(f"LOD3 Simple 생성 성공 (천장 없음): {lod_result_no_roof['mesh_stats']}")

            # LOD3 실패 시 LOD1 폴백
            if wall_result is None:
                logger.warning(f"LOD3 실패, LOD1으로 폴백")
                wall_result = create_wall_building_gltf(
                    dxf_path=str(dxf_path),
                    wall_layers=request.wall_layers,
                    height=request.height,
                    wall_thickness=request.wall_thickness,
                    output_path=str(model_path)
                )
                lod_actual = 1
                # dict 반환 (새 방식) 또는 bool 반환 (호환)
                if isinstance(wall_result, dict):
                    build_steps = wall_result.get("steps", [])
                    if not wall_result.get("success"):
                        raise HTTPException(status_code=500, detail=wall_result.get("error", "벽체 GLB 생성에 실패했습니다."))
                else:
                    build_steps = []
                    if not wall_result or not model_path.exists():
                        raise HTTPException(status_code=500, detail="벽체 GLB 생성에 실패했습니다.")
        else:
            build_steps = []
            openings_data = []  # 단순 footprint 생성에는 문/창문 없음
            glb_url_no_roof = None  # 단순 footprint 생성에는 천장 없는 버전 없음
            lod_actual = 1  # 단순 footprint 생성은 항상 LOD1
            # 기존 방식: footprint 단순 extrusion
            footprint_lonlat = np.array(request.footprint)
            centroid = footprint_lonlat.mean(axis=0)

            lat_rad = np.radians(centroid[1])
            meters_per_deg_lat = 111320
            meters_per_deg_lon = 111320 * np.cos(lat_rad)

            footprint_meters = []
            for lon, lat in request.footprint:
                x = (lon - centroid[0]) * meters_per_deg_lon
                y = (lat - centroid[1]) * meters_per_deg_lat
                footprint_meters.append([x, y])

            logger.debug(f"Footprint converted: {request.footprint} -> {footprint_meters}")
            logger.debug(f"Building size: {max(p[0] for p in footprint_meters) - min(p[0] for p in footprint_meters):.1f}m x {max(p[1] for p in footprint_meters) - min(p[1] for p in footprint_meters):.1f}m")

            success = create_building_gltf(
                footprint=footprint_meters,
                height=request.height,
                output_path=str(model_path)
            )
            if not success or not model_path.exists():
                raise HTTPException(status_code=500, detail="GLB 파일 생성에 실패했습니다.")

        # Save to database if project_id provided
        model_record = None
        if project_id:
            try:
                import uuid as uuid_module
                project_uuid = uuid_module.UUID(project_id)
                dxf_uuid = uuid_module.UUID(dxf_file_id) if dxf_file_id else None

                model_record = crud.save_generated_model(
                    db=db,
                    project_id=project_uuid,
                    dxf_file_id=dxf_uuid,
                    model_type="mass",
                    file_path=str(model_path),
                    height=request.height,
                    floors=request.floors,
                    file_size=0  # Will be updated after file creation
                )
                logger.info(f"Generated model {model_id} saved to database with project {project_id}")
            except Exception as e:
                logger.warning(f"Failed to save model record to database: {str(e)}")
                # Continue without DB - API still works

        # GLB 파일에서 실제 바운딩 박스와 메쉬 통계 읽기
        import trimesh as _trimesh
        try:
            glb_scene = _trimesh.load(str(model_path), force='scene')
            all_meshes = list(glb_scene.geometry.values())
            total_verts = sum(len(m.vertices) for m in all_meshes)
            total_faces = sum(len(m.faces) for m in all_meshes)
            wall_meshes = len(all_meshes)

            # 전체 바운딩 박스 (원점 중심 모델 → 미터 단위)
            bbox = glb_scene.bounding_box.bounds  # [[minx,miny,minz],[maxx,maxy,maxz]]
            bb_width = float(bbox[1][0] - bbox[0][0])   # X축
            bb_height = float(bbox[1][1] - bbox[0][1])   # Y축 (glTF Y-up = 건물 높이)
            bb_depth = float(bbox[1][2] - bbox[0][2])    # Z축
            logger.info(f"GLB bounding box: {bb_width:.2f} x {bb_height:.2f} x {bb_depth:.2f} m")
        except Exception as e:
            logger.warning(f"Failed to read GLB stats: {e}")
            n = len(request.footprint)
            wall_meshes = n
            total_verts = 4 * n + 2 * n
            total_faces = 2 * n + 2 * max(0, n - 2)
            bb_width = 10.0
            bb_height = request.height
            bb_depth = 10.0

        logger.info(f"[DEBUG] Creating response: model_id={model_id}, lod_actual={lod_actual}, openings={len(openings_data)}개")
        response = MassGenerateResponse(
            success=True,
            model_id=model_id,
            model_url=f"/models/{model_id}.glb",
            model_url_no_roof=glb_url_no_roof,  # None이면 None 반환
            height=request.height,
            floors=request.floors,
            mesh_stats={
                "wall_meshes": wall_meshes,
                "vertices": total_verts,
                "faces": total_faces,
            },
            bounding_box={
                "width": bb_width,
                "depth": bb_depth,
                "height": bb_height,
            },
            build_steps=build_steps if build_steps else None,
            lod_actual=lod_actual,
            openings=openings_data if openings_data else None,
        )
        logger.info(f"[DEBUG] Response created successfully")
        return response
    except Exception as e:
        logger.error(f"Error generating mass: {str(e)}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/generate-mass-multi", response_model=MultiFloorMassResponse)
async def generate_multi_floor_mass(req: MultiFloorMassRequest):
    """
    매니페스트 기반 다층 매스 생성.

    BuildingManifest 를 읽고 각 층별 LOD3 매스를 생성하여
    z 축으로 스택. 출입구/창문 메타 포함 반환.

    Args:
        req: MultiFloorMassRequest (building_id, floor_height)

    Returns:
        MultiFloorMassResponse (model_url, floors_count, main_entrance, primary_window_faces 등)
    """
    # 1. 매니페스트 로드
    manifest_path = _BACKEND_DIR / "data" / "processed" / req.building_id / "manifest.json"
    manifest = load_manifest(manifest_path)
    if not manifest:
        raise HTTPException(status_code=404, detail=f"건물 매니페스트 없음: {req.building_id}")

    # 2. 출력 경로 준비
    model_id = str(uuid.uuid4())
    output_path = MODELS_DIR / f"{model_id}.glb"

    try:
        # 3. 다층 매스 생성
        result = build_multi_floor_mass(
            manifest=manifest,
            floor_height=req.floor_height,
            output_path=str(output_path),
        )

        if not result.get("success"):
            raise HTTPException(
                status_code=500,
                detail=result.get("error", "다층 매스 생성 실패")
            )

        # 4. 응답 구성
        main_entrance = None
        if result.get("main_entrance"):
            me = result["main_entrance"]
            main_entrance = EntranceInfo(
                center=me["center"],
                width=me["width"],
                confidence=me.get("confidence", 1.0),
            )

        primary_window_faces = []
        for wf in result.get("primary_window_faces", []):
            primary_window_faces.append(WindowFaceInfo(
                floor_index=wf["floor_index"],
                midpoint=wf["midpoint"],
                direction=wf["direction"],
                length=wf["length"],
                window_count=wf["window_count"],
                confidence=wf.get("confidence", 1.0),
            ))

        mesh_stats = None
        if result.get("mesh_stats"):
            ms = result["mesh_stats"]
            mesh_stats = {
                "wall_meshes": ms.get("face_count", 0),
                "vertices": ms.get("vertex_count", 0),
                "faces": ms.get("face_count", 0),
            }

        logger.info(f"다층 매스 생성 완료: {req.building_id}, {result['floors_count']}층")

        return MultiFloorMassResponse(
            success=True,
            model_id=model_id,
            model_url=f"/models/{model_id}.glb",
            building_id=req.building_id,
            floors_count=result["floors_count"],
            total_height=result.get("total_height", 0.0),
            main_entrance=main_entrance,
            primary_window_faces=primary_window_faces,
            mesh_stats=mesh_stats,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"다층 매스 생성 오류: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/validate-placement", response_model=ValidationResponse)
async def validate_placement_endpoint(
    request: ValidationRequest,
    project_id: str = None,
    model_id: str = None,
    db: Session = Depends(get_db)
):
    """
    건축 배치 규정 검토

    검토 항목:
    - 건폐율: (건축면적/대지면적) × 100
    - 이격거리: 대지경계선~건물 최소 거리
    - 높이제한: 최고 높이 검증
    - 대지 이탈 검사

    Args:
        project_id: (Optional) 프로젝트 ID for database storage
        model_id: (Optional) 모델 ID for linking
    """
    from services.validation import (
        validate_placement,
        validate_with_zone,
        ValidationConfig,
        get_zone_config,
    )

    try:
        # 용도지역이 지정된 경우 해당 설정 사용
        if request.zone_type:
            result = validate_with_zone(
                site_footprint=request.site_footprint,
                building_footprint=request.building_footprint,
                building_height=request.building_height,
                zone_name=request.zone_type,
            )
        else:
            # 수동 설정 또는 기본값 사용
            config = ValidationConfig(
                coverage_limit=request.coverage_limit or 60.0,
                setback_required=request.setback_required or 1.5,
                height_limit=request.height_limit or 12.0,
            )
            result = validate_placement(
                site_footprint=request.site_footprint,
                building_footprint=request.building_footprint,
                building_height=request.building_height,
                config=config,
            )

        # Save to database if project_id and model_id provided
        validation_record = None
        if project_id and model_id:
            try:
                import uuid as uuid_module
                project_uuid = uuid_module.UUID(project_id)
                model_uuid = uuid_module.UUID(model_id)

                validation_record = crud.save_validation_result(
                    db=db,
                    project_id=project_uuid,
                    model_id=model_uuid,
                    is_valid=result.is_valid,
                    building_coverage=result.building_coverage,
                    setback=result.setback,
                    height_check=result.height,
                    violations=result.violations,
                    zone_type=request.zone_type
                )
                logger.info(f"Validation result saved to database for project {project_id}")
            except Exception as e:
                logger.warning(f"Failed to save validation result to database: {str(e)}")
                # Continue without DB - API still works

        response = ValidationResponse(
            is_valid=result.is_valid,
            building_coverage=result.building_coverage,
            setback=result.setback,
            height=result.height,
            violations=result.violations,
        )

        # Add validation_id if saved to DB
        if validation_record:
            response.__dict__["validation_id"] = str(validation_record.id)

        return response

    except Exception as e:
        logger.error(f"Error validating placement: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/ai/active-model")
async def get_public_active_ai_model():
    """현재 운영 중인 AI 분류 모델 정보 (사용자 페이지 노출용).

    /api/mlops/models/active 응답에는 메트릭이 없어서 실험 상세도 같이
    조회해 정확도/F1을 합쳐서 반환한다. AI 서버 응답의 model_type/created_at
    같은 필드명도 프론트가 기대하는 algorithm/trained_at으로 매핑해준다.
    """
    import httpx
    timeout = httpx.Timeout(connect=2.0, read=4.0, write=4.0, pool=4.0)

    def _flatten_metrics(metrics):
        if not isinstance(metrics, dict):
            return {}
        src = metrics.get("test") or metrics.get("val") or metrics.get("train") or {}
        if not isinstance(src, dict):
            return {"raw": metrics}
        return {
            "accuracy": src.get("accuracy"),
            "f1": src.get("f1_macro") or src.get("f1_weighted"),
            "split_used": "test" if metrics.get("test") else ("val" if metrics.get("val") else "train"),
        }

    def _normalize(exp):
        if not isinstance(exp, dict):
            return exp
        out = dict(exp)
        out["model_version"] = exp.get("model_version") or exp.get("run_id")
        out["algorithm"] = exp.get("algorithm") or exp.get("model_type")
        out["trained_at"] = exp.get("trained_at") or exp.get("created_at")
        if "metrics" in exp:
            out["metrics"] = _flatten_metrics(exp.get("metrics"))
        return out

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.get(f"{AI_SERVER_URL}/api/mlops/models/active")
            if resp.status_code == 404:
                return {"active": None, "ai_server": AI_SERVER_URL, "reason": "no_active_model"}
            if resp.status_code != 200:
                return {"active": None, "ai_server": AI_SERVER_URL, "reason": f"http_{resp.status_code}"}

            active = resp.json()
            run_id = active.get("run_id") if isinstance(active, dict) else None
            if run_id:
                try:
                    d = await client.get(f"{AI_SERVER_URL}/api/mlops/experiments/{run_id}")
                    if d.status_code == 200:
                        merged = {**d.json(), **active}
                        return {"active": _normalize(merged), "ai_server": AI_SERVER_URL}
                except Exception:
                    pass
            return {"active": _normalize(active), "ai_server": AI_SERVER_URL}
    except Exception as e:
        logger.info(f"AI active-model fetch failed: {e}")
        return {"active": None, "ai_server": AI_SERVER_URL, "reason": "unreachable"}


@app.get("/api/projects/{project_id}/dxf-files")
def list_project_dxf_files(project_id: str, db: Session = Depends(get_db)):
    """프로젝트에 업로드된 DXF 파일 목록 (사용자 사이드바 노출용)."""
    from database.models import DxfFile, ClassificationResult, GeneratedModel
    import uuid as uuid_module

    try:
        pid = uuid_module.UUID(project_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="invalid project id")

    files = (
        db.query(DxfFile)
        .filter(DxfFile.project_id == pid)
        .order_by(DxfFile.uploaded_at.desc())
        .all()
    )
    out = []
    for f in files:
        classified = (
            db.query(ClassificationResult)
            .filter(ClassificationResult.dxf_file_id == f.id)
            .count()
            > 0
        )
        gen_count = (
            db.query(GeneratedModel)
            .filter(GeneratedModel.dxf_file_id == f.id)
            .count()
        )
        out.append({
            "id": str(f.id),
            "original_filename": f.original_filename,
            "file_size": f.file_size,
            "total_entities": f.total_entities,
            "available_layers": f.available_layers or [],
            "area_sqm": f.area_sqm,
            "uploaded_at": f.uploaded_at.isoformat() if f.uploaded_at else None,
            "is_classified": classified,
            "generated_model_count": gen_count,
        })
    return {"dxf_files": out, "total": len(out)}


@app.delete("/api/dxf-files/{dxf_id}")
def delete_dxf_file(dxf_id: str, db: Session = Depends(get_db)):
    """DXF 파일 삭제 (메타 + 디스크 파일 + CASCADE로 분류·모델·검토 정리).

    사이드바와 관리자 콘솔 모두 같은 엔드포인트를 호출하므로 양쪽이 동일한
    DB 상태를 보게 된다.
    """
    from database.models import DxfFile
    import uuid as uuid_module

    try:
        did = uuid_module.UUID(dxf_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="invalid dxf id")

    f = db.query(DxfFile).filter(DxfFile.id == did).first()
    if not f:
        raise HTTPException(status_code=404, detail="dxf file not found")

    # 디스크 파일 best-effort 삭제
    try:
        path = Path(f.stored_path)
        if path.exists():
            path.unlink()
    except Exception as e:
        logger.warning(f"DXF physical file delete failed: {e}")

    db.delete(f)  # CASCADE: classification, generated_models, validation_results
    db.commit()
    return {"ok": True}


@app.post("/api/projects/{project_id}/review")
def save_review_result(
    project_id: str,
    payload: dict,
    db: Session = Depends(get_db),
):
    """클라이언트 측 규정 검토 결과를 저장한다.

    프론트엔드의 검토 탭은 모델 위치/회전/스케일과 선택된 필지를 사용해
    브라우저에서 직접 건폐율·이격거리를 계산한다. 이 결과를 admin 결과
    관리 화면에 노출하기 위해 DB로 보낸다. model_id는 선택사항이며
    백엔드 generate-mass로 생성된 모델이 있을 때만 전달된다.
    """
    try:
        import uuid as uuid_module
        project_uuid = uuid_module.UUID(project_id)
        model_id_raw = payload.get("model_id")
        model_uuid = uuid_module.UUID(model_id_raw) if model_id_raw else None

        record = crud.save_validation_result(
            db=db,
            project_id=project_uuid,
            model_id=model_uuid,
            is_valid=bool(payload.get("is_valid", False)),
            building_coverage=payload.get("building_coverage") or {},
            setback=payload.get("setback") or {},
            height_check=payload.get("height_check") or {},
            violations=payload.get("violations") or [],
            zone_type=payload.get("zone_type"),
        )
        return {"id": str(record.id), "ok": True}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"invalid uuid: {e}")
    except Exception as e:
        logger.error(f"Failed to save review result: {e}")
        raise HTTPException(status_code=500, detail=str(e))


def _validation_result_to_dict(record) -> dict:
    """ValidationResult ORM → JSON 직렬화 dict."""
    return {
        "id": str(record.id),
        "project_id": str(record.project_id),
        "model_id": str(record.model_id) if record.model_id else None,
        "is_valid": record.is_valid,
        "building_coverage": record.building_coverage,
        "setback": record.setback,
        "height_check": record.height_check,
        "violations": record.violations,
        "zone_type": record.zone_type,
        "created_at": record.created_at.isoformat() if record.created_at else None,
    }


@app.get("/api/projects/{project_id}/review")
def get_latest_review_result(
    project_id: str,
    db: Session = Depends(get_db),
):
    """프로젝트의 가장 최근 검토 결과 1건 반환.

    /editor/result 페이지가 진입 시 호출하여 저장된 결과 우선 표시.
    없으면 404 → 프론트가 새로 계산 후 POST 로 저장.
    """
    try:
        import uuid as uuid_module
        project_uuid = uuid_module.UUID(project_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"invalid uuid: {e}")

    results = crud.get_validation_results_by_project(db, project_uuid)
    if not results:
        raise HTTPException(status_code=404, detail="저장된 검토 결과가 없습니다")
    # crud 가 created_at desc 정렬해 주므로 첫 번째가 가장 최근
    return _validation_result_to_dict(results[0])


@app.get("/api/projects/{project_id}/reviews")
def list_review_history(
    project_id: str,
    limit: int = 20,
    db: Session = Depends(get_db),
):
    """프로젝트의 검토 결과 이력 (최신순). 관리자 화면 또는 결과 비교용."""
    try:
        import uuid as uuid_module
        project_uuid = uuid_module.UUID(project_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"invalid uuid: {e}")

    results = crud.get_validation_results_by_project(db, project_uuid)
    return {
        "project_id": project_id,
        "count": len(results),
        "results": [_validation_result_to_dict(r) for r in results[:limit]],
    }


# ============================================================================
# AI PROXY ENDPOINTS
# ============================================================================

AI_SERVER_URL = os.getenv("AI_SERVER_URL", "http://localhost:8001")


@app.post("/api/classify")
async def classify_layers(
    request: dict,
    project_id: str = None,
    db: Session = Depends(get_db)
):
    """
    AI 레이어 분류 프록시

    AI 서버(8001)로 분류 요청을 전달하고, 실패 시 mock 데이터를 반환합니다.

    Args:
        request: { file_id, entities: [...] }
        project_id: (Optional) 프로젝트 ID for database storage
    """
    import httpx
    import random

    file_id = request.get("file_id", "unknown")
    entities = request.get("entities", [])
    total_entities = len(entities)

    # AI 서버 스펙에 맞게 entity 필드명 정규화: type→entity_type, layer→raw_layer
    # (DXF 파서는 type/layer로 출력하지만 학과 분류 서버는 entity_type/raw_layer를 본다)
    normalized_entities = []
    for ent in entities:
        if not isinstance(ent, dict):
            continue
        normalized_entities.append({
            "entity_type": ent.get("entity_type") or ent.get("type"),
            "raw_layer": ent.get("raw_layer") or ent.get("layer"),
            "entity_id": ent.get("entity_id") or ent.get("handle"),
        })
    ai_request = {
        "file_id": request.get("file_id"),
        "entities": normalized_entities,
        "log_predictions": request.get("log_predictions", True),
    }

    # Try real AI server first
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                f"{AI_SERVER_URL}/api/classify",
                json=ai_request
            )
            if response.status_code == 200:
                ai_result = response.json()
                logger.info(f"AI classification succeeded for file {file_id}")

                # Save to database - file_id is the DXF file's UUID
                try:
                    import uuid as uuid_module
                    dxf_file_uuid = uuid_module.UUID(file_id)
                    crud.save_classification(
                        db=db,
                        dxf_file_id=dxf_file_uuid,
                        model_version=ai_result.get("model_version", "unknown"),
                        model_type=ai_result.get("model_type", "ai"),
                        class_counts=ai_result.get("class_counts", {}),
                        average_confidence=ai_result.get("average_confidence", 0),
                        total_entities=total_entities,
                    )
                    logger.info(f"Classification saved to DB for dxf_file_id={file_id}")
                except Exception as e:
                    logger.warning(f"Failed to save classification to DB: {e}")

                return ai_result
    except Exception as e:
        logger.warning(f"AI server unavailable ({AI_SERVER_URL}): {e}")

    # Fallback: Mock classification
    logger.info(f"Using mock classification for file {file_id} ({total_entities} entities)")

    if total_entities == 0:
        total_entities = 1250

    class_distribution = {
        "wall": 0.35,
        "door": 0.05,
        "window": 0.03,
        "stair": 0.02,
        "furniture": 0.10,
        "dimension": 0.20,
        "text": 0.20,
        "other": 0.05,
    }

    class_counts = {
        cls: round(total_entities * ratio)
        for cls, ratio in class_distribution.items()
    }

    # Extract unique layer names
    layer_set = set()
    for ent in entities:
        if isinstance(ent, dict) and "layer" in ent:
            layer_set.add(ent["layer"])
    layers = sorted(layer_set) if layer_set else ["WALLS", "DOORS", "WINDOWS", "FURNITURE", "DIMENSIONS", "TEXT", "OTHERS"]

    # 레이어명 키워드 휴리스틱으로 layer_decisions 생성
    # AI 서버가 다운되어 mock으로 빠져도 매스 생성 시 벽 레이어를 식별할 수 있도록 함
    layer_decisions = {layer: _classify_layer_by_name(layer) for layer in layers}

    mock_confidence = round(0.87 + random.random() * 0.08, 4)
    mock_result = {
        "file_id": file_id,
        "total_entities": total_entities,
        "class_counts": class_counts,
        "layers": layers,
        "layer_decisions": layer_decisions,
        "average_confidence": mock_confidence,
        "model_version": "mock-v1.0",
        "is_mock": True,
    }

    # Save mock result to database for tracking
    try:
        import uuid as uuid_module
        dxf_file_uuid = uuid_module.UUID(file_id)
        crud.save_classification(
            db=db,
            dxf_file_id=dxf_file_uuid,
            model_version="mock-v1.0",
            model_type="mock",
            class_counts=class_counts,
            average_confidence=mock_confidence,
            total_entities=total_entities,
        )
        logger.info(f"Mock classification saved to DB for dxf_file_id={file_id}")
    except Exception as e:
        logger.warning(f"Failed to save mock classification to DB: {e}")

    return mock_result


_LAYER_KEYWORDS: List[Tuple[str, Tuple[str, ...]]] = [
    ("wall", ("wall", "벽", "wal", "외벽", "내벽", "조적", "structural", "struct",
              "muro", "muros", "medianera", "viga", "cuadro")),  # Spanish
    ("door", ("door", "문", "dr", "출입", "puerta", "puertas")),  # Spanish
    ("window", ("window", "창", "win", "wd", "sash", "ventana", "ventanas")),  # Spanish
    ("stair", ("stair", "계단", "step", "stairs", "escalera")),  # Spanish
    ("furniture", ("furn", "가구", "fixture", "fix", "equip", "fur", "mueble")),  # Spanish
    ("dimension", ("dim", "치수", "annotation", "anno", "cota")),  # Spanish
    ("text", ("text", "txt", "글자", "label", "texto")),  # Spanish
]


def _classify_layer_by_name(layer: str) -> str:
    """레이어 이름으로부터 클래스를 추정한다.

    DXF 레이어 명명 규칙은 회사·도면별로 천차만별이지만 wall/벽/door/창 같은
    공통 키워드는 거의 모든 도면에서 등장한다. AI 서버가 다운된 경우에도
    매스 생성이 직육면체로 떨어지지 않도록 최소한의 휴리스틱을 제공한다.
    """
    name = layer.lower()
    for cls, keywords in _LAYER_KEYWORDS:
        if any(k in name for k in keywords):
            return cls
    return "other"


# NOTE: /api/report (docx 보고서) 엔드포인트 삭제됨 — Node.js 의존성 제거


# ============================================================================
# SUNLIGHT ANALYSIS ENDPOINTS
# ============================================================================


@app.post("/api/projects/{project_id}/sunlight-analysis")
async def save_sunlight_analysis_endpoint(
    project_id: str,
    payload: dict,
    db: Session = Depends(get_db)
):
    """일조 분석 결과 저장"""
    try:
        import uuid as uuid_module
        from datetime import date as date_type

        project_uuid = uuid_module.UUID(project_id)

        # 포인트 데이터에서 통계 계산
        points = payload.get("points", [])
        hours_list = [p.get("sunlightHours", 0) for p in points]

        analysis = crud.save_sunlight_analysis(
            db=db,
            project_id=project_uuid,
            analysis_date=date_type.fromisoformat(payload.get("analysisDate", date_type.today().isoformat())),
            grid_spacing=payload.get("gridSpacing", 2.0),
            total_points=len(points),
            avg_sunlight_hours=sum(hours_list) / len(hours_list) if hours_list else 0,
            min_sunlight_hours=min(hours_list) if hours_list else 0,
            max_sunlight_hours=max(hours_list) if hours_list else 0,
            points_data=points,
        )

        return {
            "success": True,
            "analysisId": str(analysis.id),
            "message": "저장 완료",
        }
    except Exception as e:
        logger.error(f"Failed to save sunlight analysis: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/projects/{project_id}/sunlight-analysis")
async def get_sunlight_analysis_endpoint(
    project_id: str,
    date: str = None,
    db: Session = Depends(get_db)
):
    """일조 분석 결과 조회 (최신 또는 날짜 지정)"""
    try:
        import uuid as uuid_module
        project_uuid = uuid_module.UUID(project_id)

        if date:
            # 특정 날짜 분석 조회
            analyses = crud.get_sunlight_analyses_by_project(db, project_uuid)
            analysis = next(
                (a for a in analyses if a.analysis_date.isoformat() == date),
                None
            )
        else:
            analysis = crud.get_latest_sunlight_analysis(db, project_uuid)

        if not analysis:
            raise HTTPException(status_code=404, detail="일조 분석 결과가 없습니다")

        return {
            "analysisId": str(analysis.id),
            "analysisDate": analysis.analysis_date.isoformat(),
            "gridSpacing": analysis.grid_spacing,
            "totalPoints": analysis.total_points,
            "avgSunlightHours": analysis.avg_sunlight_hours,
            "minSunlightHours": analysis.min_sunlight_hours,
            "maxSunlightHours": analysis.max_sunlight_hours,
            "points": analysis.points_data or [],
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get sunlight analysis: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/projects/{project_id}/sunlight-analysis/{analysis_id}")
async def delete_sunlight_analysis_endpoint(
    project_id: str,
    analysis_id: str,
    db: Session = Depends(get_db)
):
    """일조 분석 결과 삭제"""
    try:
        import uuid as uuid_module
        analysis_uuid = uuid_module.UUID(analysis_id)

        deleted = crud.delete_sunlight_analysis(db, analysis_uuid)
        if not deleted:
            raise HTTPException(status_code=404, detail="분석 결과를 찾을 수 없습니다")

        return {"success": True, "message": "삭제 완료"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete sunlight analysis: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# PARKING ENDPOINTS
# ============================================================================


@app.get("/api/parking/use-types")
async def get_parking_use_types():
    """주차 대수 산정에 사용할 수 있는 건물 용도 목록"""
    from services.parking_calculator import get_available_use_types
    return {"use_types": get_available_use_types()}


@app.post("/api/parking/calculate-required", response_model=ParkingRequirementResponse)
async def calculate_parking_required(request: ParkingRequirementRequest):
    """
    주차장법 시행규칙 별표1 기반 필요 주차 대수 산정

    건물 용도 + 연면적 → 필요 총 대수, 장애인 전용 대수
    """
    from services.parking_calculator import calculate_required_parking

    try:
        result = calculate_required_parking(
            building_use=request.building_use,
            gross_floor_area_m2=request.gross_floor_area_m2,
            ramp=request.ramp,
        )
        return ParkingRequirementResponse(
            building_use=result.building_use,
            gross_floor_area_m2=result.gross_floor_area_m2,
            ratio_area_m2=result.ratio_area_m2,
            ratio_count=result.ratio_count,
            required_total=result.required_total,
            required_disabled=result.required_disabled,
            required_standard=result.required_standard,
            ramp_extra_factor=result.ramp_extra_factor,
            note=result.note,
        )
    except Exception as e:
        logger.error(f"Parking calculation error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/parking/generate-layout", response_model=ParkingLayoutResponse)
async def generate_parking_layout_endpoint(request: ParkingLayoutRequest):
    """
    주차구역 자동 배치

    대지·건물 footprint + 필요 대수 → 슬롯·차로·진입로 배치 결과
    """
    from services.parking_layout import generate_parking_layout

    try:
        layout = generate_parking_layout(
            site_coords=request.site_footprint,
            building_coords=request.building_footprint,
            required_total=request.required_total,
            required_disabled=request.required_disabled,
            road_lines=request.road_lines,
            preferred_heading=request.preferred_heading,
        )
        return ParkingLayoutResponse(
            slots=[
                {
                    "id": s.id,
                    "slot_type": s.slot_type,
                    "cx": s.cx,
                    "cy": s.cy,
                    "width": s.width,
                    "depth": s.depth,
                    "heading": s.heading,
                    "polygon": s.polygon,
                }
                for s in layout.slots
            ],
            aisles=[
                {"polygon": a.polygon, "direction": a.direction}
                for a in layout.aisles
            ],
            access_point={
                "x": layout.access_point.x,
                "y": layout.access_point.y,
                "road_x": layout.access_point.road_x,
                "road_y": layout.access_point.road_y,
                "width": layout.access_point.width,
            } if layout.access_point else None,
            zone_polygon=layout.zone_polygon,
            zone_center=layout.zone_center,
            zone_rotation=layout.zone_rotation,
            zone_width=layout.zone_width,
            zone_depth=layout.zone_depth,
            total_slots=layout.total_slots,
            standard_slots=layout.standard_slots,
            disabled_slots=layout.disabled_slots,
            total_area_m2=layout.total_area_m2,
            parking_area_ratio=layout.parking_area_ratio,
            warnings=layout.warnings,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Parking layout error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============= 샘플 프리셋 API =============

from services.sample_presets import get_all_presets, get_preset_by_id, get_preset_filepath

@app.get("/api/samples")
async def list_sample_presets():
    """사용 가능한 샘플 DXF 프리셋 목록 반환."""
    presets = get_all_presets()
    return {"samples": presets, "count": len(presets)}


@app.get("/api/samples/{preset_id}")
async def get_sample_preset(preset_id: str):
    """특정 샘플 프리셋 정보 반환."""
    preset = get_preset_by_id(preset_id)
    if not preset:
        raise HTTPException(status_code=404, detail=f"샘플 프리셋 '{preset_id}'를 찾을 수 없습니다.")
    return preset


@app.post("/api/samples/{preset_id}/generate")
async def generate_from_sample(preset_id: str, height: float = 3.0):
    """샘플 프리셋으로 3D 매스 생성.

    프리셋에 정의된 레이어 설정을 사용하여 즉시 매스를 생성합니다.
    """
    from services.lod.lod3_simple import build_lod3_simple

    preset = get_preset_by_id(preset_id)
    if not preset:
        raise HTTPException(status_code=404, detail=f"샘플 프리셋 '{preset_id}'를 찾을 수 없습니다.")

    filepath = get_preset_filepath(preset_id)
    if not filepath or not filepath.exists():
        raise HTTPException(status_code=404, detail=f"샘플 파일을 찾을 수 없습니다: {preset['filename']}")

    # 고유 모델 ID 생성
    model_id = f"sample_{preset_id}_{uuid.uuid4().hex[:8]}"
    model_path = MODELS_DIR / f"{model_id}.glb"
    model_path_no_roof = MODELS_DIR / f"{model_id}_no_roof.glb"

    try:
        # LOD3 Simple 매스 생성 (천장 포함)
        lod_result = build_lod3_simple(
            str(filepath),
            preset["wall_layers"],
            preset.get("door_layers", []),
            preset.get("window_layers", []),
            height=height,
            output_path=str(model_path),
            include_roof=True
        )

        if not lod_result:
            raise HTTPException(status_code=500, detail="매스 생성에 실패했습니다.")

        # 천장 없는 버전도 생성
        glb_url_no_roof = None
        lod_result_no_roof = build_lod3_simple(
            str(filepath),
            preset["wall_layers"],
            preset.get("door_layers", []),
            preset.get("window_layers", []),
            height=height,
            output_path=str(model_path_no_roof),
            include_roof=False
        )
        if lod_result_no_roof:
            glb_url_no_roof = f"/models/{model_id}_no_roof.glb"

        return {
            "success": True,
            "preset_id": preset_id,
            "preset_name": preset["name"],
            "model_id": model_id,
            "model_url": f"/models/{model_id}.glb",
            "model_url_no_roof": glb_url_no_roof,
            "height": height,
            "mesh_stats": lod_result.get("mesh_stats", {}),
            "bounding_box": lod_result.get("mesh_stats", {}).get("bounding_box"),
            "openings": lod_result.get("openings", []),
            "build_steps": lod_result.get("steps", []),
        }
    except Exception as e:
        logger.error(f"샘플 매스 생성 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


_FRONTEND_PUBLIC_MODELS_DIR = (
    _BACKEND_DIR.parent / "frontend" / "public" / "models"
)


@app.get("/api/models/{model_id}.glb")
async def get_model(model_id: str):
    """glTF 모델 파일 다운로드.

    1순위: backend/MODELS_DIR — 매스 생성 결과(uuid.glb)
    2순위: frontend/public/models — 샘플/휴먼 스케일 모델
        (Next.js의 /api/* rewrite가 프론트 라우트를 가려서 모든 모델 요청이
         백엔드로 오므로, 여기서 함께 서빙해야 함)
    """
    model_path = MODELS_DIR / f"{model_id}.glb"

    if not model_path.exists():
        fallback = _FRONTEND_PUBLIC_MODELS_DIR / f"{model_id}.glb"
        if fallback.exists():
            return FileResponse(
                path=fallback,
                media_type="model/gltf-binary",
                filename=f"{model_id}.glb",
            )
        raise HTTPException(status_code=404, detail="모델을 찾을 수 없습니다")

    return FileResponse(
        path=model_path,
        media_type="model/gltf-binary",
        filename=f"{model_id}.glb"
    )


# ─── AI 스코어링 ─────────────────────────────────────────

@app.post("/api/ai-scoring", response_model=AIScoringResponse)
async def ai_scoring(request: AIScoringRequest):
    """
    LLM 기반 배치 종합 스코어링

    배치검토(건폐율·이격·높이) + 주차 + 일조 데이터를
    학과 LLM 서버로 보내 항목별 등급(A~F)과 종합점수(0~100)를 반환합니다.
    LLM 연결 실패 시 규칙 기반 폴백 스코어를 자동 생성합니다.
    """
    from services.llm_scorer import score_placement

    try:
        result = await score_placement(
            validation=request.validation,
            parking=request.parking,
            sunlight=request.sunlight,
        )

        return AIScoringResponse(
            success=True,
            category_grades=result["category_grades"],
            overall_score=result["overall_score"],
            summary=result["summary"],
            suggestions=result["suggestions"],
            source=result.get("source", "llm"),
            error=result.get("error"),
        )

    except Exception as e:
        logger.error(f"AI scoring endpoint error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=os.getenv("BACKEND_HOST", "0.0.0.0"),
        port=int(os.getenv("BACKEND_PORT", 8000)),
        reload=True
    )
