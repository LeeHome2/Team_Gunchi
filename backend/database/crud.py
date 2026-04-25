"""
CRUD operations for database models
"""

from sqlalchemy.orm import Session
from sqlalchemy import desc
from uuid import UUID
from typing import List, Optional, Dict, Any
from datetime import datetime, date

from .models import (
    Project, DxfFile, ClassificationResult, GeneratedModel,
    ValidationResult, SunlightAnalysis, PlacementOptimization,
    AIModelVersion,
    User, AdminAccount, ApiKey, RegulationBaseRule, RegulationZoneRule,
    ServiceSetting,
)


# ============================================================================
# PROJECT CRUD
# ============================================================================

def create_project(
    db: Session,
    name: str,
    user_id: Optional[UUID] = None,
    address: Optional[str] = None,
    longitude: Optional[float] = None,
    latitude: Optional[float] = None,
    zone_type: Optional[str] = None
) -> Project:
    """Create a new project"""
    project = Project(
        name=name,
        user_id=user_id,
        address=address,
        longitude=longitude,
        latitude=latitude,
        zone_type=zone_type
    )
    db.add(project)
    db.commit()
    db.refresh(project)

    # Update user's project count
    if user_id:
        user = get_user(db, user_id)
        if user:
            user.project_count = db.query(Project).filter(Project.user_id == user_id).count()
            db.commit()

    return project


def get_project(db: Session, project_id: UUID) -> Optional[Project]:
    """Get project by ID"""
    return db.query(Project).filter(Project.id == project_id).first()


def get_all_projects(db: Session, skip: int = 0, limit: int = 100, user_id: Optional[UUID] = None) -> List[Project]:
    """Get all projects with pagination, optionally filtered by user"""
    query = db.query(Project)
    if user_id:
        query = query.filter(Project.user_id == user_id)
    return query.order_by(desc(Project.created_at)).offset(skip).limit(limit).all()


def get_projects_by_user(db: Session, user_id: UUID, skip: int = 0, limit: int = 100) -> List[Project]:
    """Get all projects for a specific user"""
    return db.query(Project).filter(
        Project.user_id == user_id
    ).order_by(desc(Project.created_at)).offset(skip).limit(limit).all()


def update_project(
    db: Session,
    project_id: UUID,
    **kwargs
) -> Optional[Project]:
    """Update project"""
    project = get_project(db, project_id)
    if not project:
        return None

    for key, value in kwargs.items():
        if hasattr(project, key):
            setattr(project, key, value)

    db.commit()
    db.refresh(project)
    return project


def delete_project(db: Session, project_id: UUID) -> bool:
    """Delete project and all related data"""
    project = get_project(db, project_id)
    if not project:
        return False

    db.delete(project)
    db.commit()
    return True


# ============================================================================
# DXF FILE CRUD
# ============================================================================

def create_dxf_file(
    db: Session,
    project_id: UUID,
    original_filename: str,
    stored_path: str,
    file_size: int,
    total_entities: Optional[int] = None,
    available_layers: Optional[List[str]] = None,
    footprint: Optional[List[List[float]]] = None,
    area_sqm: Optional[float] = None,
    centroid: Optional[List[float]] = None,
    bounds: Optional[Dict[str, float]] = None
) -> DxfFile:
    """Create a new DXF file record"""
    dxf_file = DxfFile(
        project_id=project_id,
        original_filename=original_filename,
        stored_path=stored_path,
        file_size=file_size,
        total_entities=total_entities,
        available_layers=available_layers,
        footprint=footprint,
        area_sqm=area_sqm,
        centroid=centroid,
        bounds=bounds
    )
    db.add(dxf_file)
    db.commit()
    db.refresh(dxf_file)
    return dxf_file


def get_dxf_file(db: Session, dxf_file_id: UUID) -> Optional[DxfFile]:
    """Get DXF file by ID"""
    return db.query(DxfFile).filter(DxfFile.id == dxf_file_id).first()


def get_dxf_files_by_project(db: Session, project_id: UUID) -> List[DxfFile]:
    """Get all DXF files for a project"""
    return db.query(DxfFile).filter(
        DxfFile.project_id == project_id
    ).order_by(desc(DxfFile.uploaded_at)).all()


def delete_dxf_file(db: Session, dxf_file_id: UUID) -> bool:
    """Delete DXF file record"""
    dxf_file = get_dxf_file(db, dxf_file_id)
    if not dxf_file:
        return False

    db.delete(dxf_file)
    db.commit()
    return True


# ============================================================================
# CLASSIFICATION RESULT CRUD
# ============================================================================

def save_classification(
    db: Session,
    dxf_file_id: UUID,
    model_version: str,
    model_type: str,
    class_counts: Dict[str, int],
    average_confidence: float,
    total_entities: int,
    processing_time_ms: Optional[int] = None
) -> ClassificationResult:
    """Save AI classification result"""
    classification = ClassificationResult(
        dxf_file_id=dxf_file_id,
        model_version=model_version,
        model_type=model_type,
        class_counts=class_counts,
        average_confidence=average_confidence,
        total_entities=total_entities,
        processing_time_ms=processing_time_ms
    )
    db.add(classification)
    db.commit()
    db.refresh(classification)
    return classification


def get_classification(db: Session, classification_id: UUID) -> Optional[ClassificationResult]:
    """Get classification result by ID"""
    return db.query(ClassificationResult).filter(
        ClassificationResult.id == classification_id
    ).first()


def get_latest_classification(db: Session, dxf_file_id: UUID) -> Optional[ClassificationResult]:
    """Get latest classification for a DXF file"""
    return db.query(ClassificationResult).filter(
        ClassificationResult.dxf_file_id == dxf_file_id
    ).order_by(desc(ClassificationResult.created_at)).first()


def get_classifications_by_dxf(db: Session, dxf_file_id: UUID) -> List[ClassificationResult]:
    """Get all classifications for a DXF file"""
    return db.query(ClassificationResult).filter(
        ClassificationResult.dxf_file_id == dxf_file_id
    ).order_by(desc(ClassificationResult.created_at)).all()


# ============================================================================
# GENERATED MODEL CRUD
# ============================================================================

def save_generated_model(
    db: Session,
    project_id: UUID,
    model_type: str,
    file_path: str,
    height: float,
    floors: int,
    dxf_file_id: Optional[UUID] = None,
    classification_id: Optional[UUID] = None,
    file_size: Optional[int] = None
) -> GeneratedModel:
    """Save generated 3D model"""
    model = GeneratedModel(
        project_id=project_id,
        dxf_file_id=dxf_file_id,
        classification_id=classification_id,
        model_type=model_type,
        file_path=file_path,
        file_size=file_size,
        height=height,
        floors=floors
    )
    db.add(model)
    db.commit()
    db.refresh(model)
    return model


def get_generated_model(db: Session, model_id: UUID) -> Optional[GeneratedModel]:
    """Get generated model by ID"""
    return db.query(GeneratedModel).filter(GeneratedModel.id == model_id).first()


def get_generated_models_by_project(db: Session, project_id: UUID) -> List[GeneratedModel]:
    """Get all generated models for a project"""
    return db.query(GeneratedModel).filter(
        GeneratedModel.project_id == project_id
    ).order_by(desc(GeneratedModel.created_at)).all()


def delete_generated_model(db: Session, model_id: UUID) -> bool:
    """Delete generated model record"""
    model = get_generated_model(db, model_id)
    if not model:
        return False

    db.delete(model)
    db.commit()
    return True


# ============================================================================
# VALIDATION RESULT CRUD
# ============================================================================

def save_validation_result(
    db: Session,
    project_id: UUID,
    model_id: Optional[UUID],
    is_valid: bool,
    building_coverage: Dict[str, Any],
    setback: Dict[str, Any],
    height_check: Dict[str, Any],
    violations: List[Dict[str, str]],
    zone_type: Optional[str] = None
) -> ValidationResult:
    """Save validation result"""
    validation = ValidationResult(
        project_id=project_id,
        model_id=model_id,
        is_valid=is_valid,
        building_coverage=building_coverage,
        setback=setback,
        height_check=height_check,
        violations=violations,
        zone_type=zone_type
    )
    db.add(validation)
    db.commit()
    db.refresh(validation)
    return validation


def get_validation_result(db: Session, validation_id: UUID) -> Optional[ValidationResult]:
    """Get validation result by ID"""
    return db.query(ValidationResult).filter(
        ValidationResult.id == validation_id
    ).first()


def get_validation_results_by_model(db: Session, model_id: UUID) -> List[ValidationResult]:
    """Get all validation results for a model"""
    return db.query(ValidationResult).filter(
        ValidationResult.model_id == model_id
    ).order_by(desc(ValidationResult.created_at)).all()


def get_validation_results_by_project(db: Session, project_id: UUID) -> List[ValidationResult]:
    """Get all validation results for a project"""
    return db.query(ValidationResult).filter(
        ValidationResult.project_id == project_id
    ).order_by(desc(ValidationResult.created_at)).all()


# ============================================================================
# SUNLIGHT ANALYSIS CRUD
# ============================================================================

def save_sunlight_analysis(
    db: Session,
    project_id: UUID,
    analysis_date: date,
    grid_spacing: float,
    total_points: int,
    avg_sunlight_hours: float,
    min_sunlight_hours: float,
    max_sunlight_hours: float,
    model_id: Optional[UUID] = None,
    points_data: Optional[List[Dict[str, Any]]] = None
) -> SunlightAnalysis:
    """Save sunlight analysis result"""
    analysis = SunlightAnalysis(
        project_id=project_id,
        model_id=model_id,
        analysis_date=analysis_date,
        grid_spacing=grid_spacing,
        total_points=total_points,
        avg_sunlight_hours=avg_sunlight_hours,
        min_sunlight_hours=min_sunlight_hours,
        max_sunlight_hours=max_sunlight_hours,
        points_data=points_data
    )
    db.add(analysis)
    db.commit()
    db.refresh(analysis)
    return analysis


def get_sunlight_analysis(db: Session, analysis_id: UUID) -> Optional[SunlightAnalysis]:
    """Get sunlight analysis by ID"""
    return db.query(SunlightAnalysis).filter(
        SunlightAnalysis.id == analysis_id
    ).first()


def get_sunlight_analyses_by_project(db: Session, project_id: UUID) -> List[SunlightAnalysis]:
    """Get all sunlight analyses for a project"""
    return db.query(SunlightAnalysis).filter(
        SunlightAnalysis.project_id == project_id
    ).order_by(desc(SunlightAnalysis.analysis_date)).all()


def get_latest_sunlight_analysis(db: Session, project_id: UUID) -> Optional[SunlightAnalysis]:
    """Get latest sunlight analysis for a project"""
    return db.query(SunlightAnalysis).filter(
        SunlightAnalysis.project_id == project_id
    ).order_by(desc(SunlightAnalysis.created_at)).first()


def delete_sunlight_analysis(db: Session, analysis_id: UUID) -> bool:
    """Delete a sunlight analysis by ID. Returns True if deleted."""
    analysis = db.query(SunlightAnalysis).filter(
        SunlightAnalysis.id == analysis_id
    ).first()
    if not analysis:
        return False
    db.delete(analysis)
    db.commit()
    return True


# ============================================================================
# PLACEMENT OPTIMIZATION CRUD
# ============================================================================

def save_placement_optimization(
    db: Session,
    project_id: UUID,
    model_id: UUID,
    model_version: str,
    total_candidates_evaluated: int,
    candidates: List[Dict[str, Any]],
    weights: Dict[str, float],
    computation_time_ms: Optional[int] = None
) -> PlacementOptimization:
    """Save placement optimization result"""
    optimization = PlacementOptimization(
        project_id=project_id,
        model_id=model_id,
        model_version=model_version,
        total_candidates_evaluated=total_candidates_evaluated,
        candidates=candidates,
        weights=weights,
        computation_time_ms=computation_time_ms
    )
    db.add(optimization)
    db.commit()
    db.refresh(optimization)
    return optimization


def get_placement_optimization(db: Session, optimization_id: UUID) -> Optional[PlacementOptimization]:
    """Get placement optimization by ID"""
    return db.query(PlacementOptimization).filter(
        PlacementOptimization.id == optimization_id
    ).first()


def get_placement_optimizations_by_model(db: Session, model_id: UUID) -> List[PlacementOptimization]:
    """Get all optimizations for a model"""
    return db.query(PlacementOptimization).filter(
        PlacementOptimization.model_id == model_id
    ).order_by(desc(PlacementOptimization.created_at)).all()


def get_latest_placement_optimization(db: Session, project_id: UUID) -> Optional[PlacementOptimization]:
    """Get latest placement optimization for a project"""
    return db.query(PlacementOptimization).filter(
        PlacementOptimization.project_id == project_id
    ).order_by(desc(PlacementOptimization.created_at)).first()


# ============================================================================
# AI MODEL VERSION CRUD
# ============================================================================

def create_ai_model_version(
    db: Session,
    model_name: str,
    version: str,
    model_type: str,
    accuracy: Optional[float] = None,
    file_path: Optional[str] = None,
    description: Optional[str] = None,
    trained_at: Optional[datetime] = None
) -> AIModelVersion:
    """Create a new AI model version"""
    model = AIModelVersion(
        model_name=model_name,
        version=version,
        model_type=model_type,
        accuracy=accuracy,
        file_path=file_path,
        description=description,
        trained_at=trained_at,
        is_active=False
    )
    db.add(model)
    db.commit()
    db.refresh(model)
    return model


def get_ai_model_version(db: Session, model_id: UUID) -> Optional[AIModelVersion]:
    """Get AI model version by ID"""
    return db.query(AIModelVersion).filter(AIModelVersion.id == model_id).first()


def get_active_model(db: Session, model_name: str) -> Optional[AIModelVersion]:
    """Get currently active AI model by name"""
    return db.query(AIModelVersion).filter(
        AIModelVersion.model_name == model_name,
        AIModelVersion.is_active == True
    ).order_by(desc(AIModelVersion.created_at)).first()


def list_model_versions(
    db: Session,
    model_name: str,
    skip: int = 0,
    limit: int = 100
) -> List[AIModelVersion]:
    """List all versions of a model"""
    return db.query(AIModelVersion).filter(
        AIModelVersion.model_name == model_name
    ).order_by(desc(AIModelVersion.created_at)).offset(skip).limit(limit).all()


def set_active_model(db: Session, model_id: UUID) -> Optional[AIModelVersion]:
    """Set a model as active (deactivates previous active model)"""
    # Get the model to activate
    model = get_ai_model_version(db, model_id)
    if not model:
        return None

    # Deactivate any previously active models with the same name
    db.query(AIModelVersion).filter(
        AIModelVersion.model_name == model.model_name,
        AIModelVersion.is_active == True
    ).update({AIModelVersion.is_active: False})

    # Activate this model
    model.is_active = True
    db.commit()
    db.refresh(model)
    return model


def deactivate_model(db: Session, model_id: UUID) -> Optional[AIModelVersion]:
    """Deactivate a model"""
    model = get_ai_model_version(db, model_id)
    if not model:
        return None

    model.is_active = False
    db.commit()
    db.refresh(model)
    return model


def list_all_model_versions(db: Session) -> List[AIModelVersion]:
    """List all model versions across model_names, newest first."""
    return (
        db.query(AIModelVersion)
        .order_by(desc(AIModelVersion.created_at))
        .all()
    )


# ============================================================================
# USER CRUD
# ============================================================================

def list_users(
    db: Session,
    status: Optional[str] = None,
    query: Optional[str] = None,
    limit: int = 200,
) -> List[User]:
    q = db.query(User)
    if status:
        q = q.filter(User.status == status)
    if query:
        # LIKE 와일드카드 문자 이스케이프 (SQL Injection 방지)
        escaped_query = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        like = f"%{escaped_query}%"
        q = q.filter((User.name.ilike(like, escape="\\")) | (User.email.ilike(like, escape="\\")))
    return q.order_by(desc(User.joined_at)).limit(limit).all()


def get_user(db: Session, user_id: UUID) -> Optional[User]:
    return db.query(User).filter(User.id == user_id).first()


def get_user_by_email(db: Session, email: str) -> Optional[User]:
    """Get user by email address"""
    return db.query(User).filter(User.email == email).first()


def create_user(
    db: Session,
    name: str,
    email: str,
    password_hash: Optional[str] = None,
    status: str = "active"
) -> User:
    """Create a new user"""
    user = User(name=name, email=email, password_hash=password_hash, status=status)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def update_user_status(db: Session, user_id: UUID, status: str) -> Optional[User]:
    user = get_user(db, user_id)
    if not user:
        return None
    user.status = status
    db.commit()
    db.refresh(user)
    return user


def delete_user(db: Session, user_id: UUID) -> bool:
    user = get_user(db, user_id)
    if not user:
        return False
    db.delete(user)
    db.commit()
    return True


def count_users_by_status(db: Session) -> Dict[str, int]:
    rows = db.query(User.status, db.query(User).filter(User.status == User.status).count())
    # Simpler: do explicit counts
    return {
        "total": db.query(User).count(),
        "active": db.query(User).filter(User.status == "active").count(),
        "pending": db.query(User).filter(User.status == "pending").count(),
        "suspended": db.query(User).filter(User.status == "suspended").count(),
    }


# ============================================================================
# ADMIN ACCOUNT CRUD
# ============================================================================

def list_admin_accounts(db: Session) -> List[AdminAccount]:
    return db.query(AdminAccount).order_by(desc(AdminAccount.created_at)).all()


def get_admin_account(db: Session, admin_id: UUID) -> Optional[AdminAccount]:
    return db.query(AdminAccount).filter(AdminAccount.id == admin_id).first()


def create_admin_account(
    db: Session, email: str, name: str, role: str = "viewer"
) -> AdminAccount:
    admin = AdminAccount(email=email, name=name, role=role, is_active=True)
    db.add(admin)
    db.commit()
    db.refresh(admin)
    return admin


def update_admin_account(
    db: Session,
    admin_id: UUID,
    name: Optional[str] = None,
    role: Optional[str] = None,
    is_active: Optional[bool] = None,
) -> Optional[AdminAccount]:
    admin = get_admin_account(db, admin_id)
    if not admin:
        return None
    if name is not None:
        admin.name = name
    if role is not None:
        admin.role = role
    if is_active is not None:
        admin.is_active = is_active
    db.commit()
    db.refresh(admin)
    return admin


def delete_admin_account(db: Session, admin_id: UUID) -> bool:
    admin = get_admin_account(db, admin_id)
    if not admin:
        return False
    db.delete(admin)
    db.commit()
    return True


# ============================================================================
# API KEY CRUD
# ============================================================================

def list_api_keys(db: Session) -> List[ApiKey]:
    return db.query(ApiKey).order_by(desc(ApiKey.created_at)).all()


def get_api_key(db: Session, key_id: UUID) -> Optional[ApiKey]:
    return db.query(ApiKey).filter(ApiKey.id == key_id).first()


def create_api_key(
    db: Session,
    name: str,
    prefix: str,
    environment: str = "live",
    key_hash: Optional[str] = None,
) -> ApiKey:
    key = ApiKey(
        name=name,
        prefix=prefix,
        environment=environment,
        key_hash=key_hash,
        is_active=True,
    )
    db.add(key)
    db.commit()
    db.refresh(key)
    return key


def revoke_api_key(db: Session, key_id: UUID) -> Optional[ApiKey]:
    key = get_api_key(db, key_id)
    if not key:
        return None
    key.is_active = False
    db.commit()
    db.refresh(key)
    return key


def delete_api_key(db: Session, key_id: UUID) -> bool:
    key = get_api_key(db, key_id)
    if not key:
        return False
    db.delete(key)
    db.commit()
    return True


# ============================================================================
# REGULATION CRUD
# ============================================================================

def list_base_rules(db: Session) -> List[RegulationBaseRule]:
    return db.query(RegulationBaseRule).order_by(RegulationBaseRule.key).all()


def get_base_rule(db: Session, key: str) -> Optional[RegulationBaseRule]:
    return db.query(RegulationBaseRule).filter(RegulationBaseRule.key == key).first()


def upsert_base_rule(
    db: Session,
    key: str,
    label: str,
    unit: str,
    value: float,
    description: Optional[str] = None,
) -> RegulationBaseRule:
    rule = get_base_rule(db, key)
    if rule:
        rule.label = label
        rule.unit = unit
        rule.value = value
        rule.description = description
    else:
        rule = RegulationBaseRule(
            key=key, label=label, unit=unit, value=value, description=description
        )
        db.add(rule)
    db.commit()
    db.refresh(rule)
    return rule


def list_zone_rules(db: Session) -> List[RegulationZoneRule]:
    return (
        db.query(RegulationZoneRule)
        .order_by(RegulationZoneRule.region, RegulationZoneRule.zone)
        .all()
    )


def get_zone_rule(db: Session, rule_id: UUID) -> Optional[RegulationZoneRule]:
    return db.query(RegulationZoneRule).filter(RegulationZoneRule.id == rule_id).first()


def create_zone_rule(
    db: Session,
    zone: str,
    region: str,
    coverage: float,
    far: float,
    height_max: float,
    setback: float,
) -> RegulationZoneRule:
    rule = RegulationZoneRule(
        zone=zone,
        region=region,
        coverage=coverage,
        far=far,
        height_max=height_max,
        setback=setback,
    )
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return rule


def update_zone_rule(
    db: Session,
    rule_id: UUID,
    **fields,
) -> Optional[RegulationZoneRule]:
    rule = get_zone_rule(db, rule_id)
    if not rule:
        return None
    for k, v in fields.items():
        if hasattr(rule, k) and v is not None:
            setattr(rule, k, v)
    db.commit()
    db.refresh(rule)
    return rule


def delete_zone_rule(db: Session, rule_id: UUID) -> bool:
    rule = get_zone_rule(db, rule_id)
    if not rule:
        return False
    db.delete(rule)
    db.commit()
    return True


# ============================================================================
# SERVICE SETTINGS
# ============================================================================

def list_service_settings(db: Session) -> Dict[str, str]:
    rows = db.query(ServiceSetting).all()
    return {r.key: r.value for r in rows}


def upsert_service_setting(db: Session, key: str, value: str) -> ServiceSetting:
    row = db.query(ServiceSetting).filter(ServiceSetting.key == key).first()
    if row:
        row.value = value
    else:
        row = ServiceSetting(key=key, value=value)
        db.add(row)
    db.commit()
    db.refresh(row)
    return row


# ============================================================================
# DASHBOARD AGGREGATES
# ============================================================================

def dashboard_metrics(db: Session) -> Dict[str, Any]:
    """관리자 대시보드 집계 수치를 최소 쿼리로 조회.

    원래 count 쿼리 4개 + groupby + recent projects = 6 round-trip 이었음.
    여기서는 다음 3개 round-trip 으로 줄인다:
      1) total_projects + total_users + total_validations + valid_count (단일 SELECT)
      2) 최근 7일 프로젝트 groupby
      3) 최근 프로젝트 5개
    """
    from sqlalchemy import func as sa_func, case
    from datetime import timedelta

    # 1) 모든 count를 한 번의 SELECT로
    #    scalar subqueries 를 써서 1-round-trip 으로 4개 값 취득
    counts_row = db.query(
        db.query(sa_func.count(Project.id)).scalar_subquery().label("total_projects"),
        db.query(sa_func.count(User.id)).scalar_subquery().label("total_users"),
        db.query(sa_func.count(ValidationResult.id))
        .scalar_subquery()
        .label("total_validations"),
        db.query(sa_func.count(ValidationResult.id))
        .filter(ValidationResult.is_valid == True)  # noqa: E712
        .scalar_subquery()
        .label("valid_count"),
    ).one()

    total_projects = int(counts_row.total_projects or 0)
    total_users = int(counts_row.total_users or 0)
    total_validations = int(counts_row.total_validations or 0)
    valid_count = int(counts_row.valid_count or 0)
    invalid_count = total_validations - valid_count

    # 2) 최근 7일 프로젝트 생성 수
    now = datetime.utcnow()
    seven_days_ago = now - timedelta(days=7)
    weekly_rows = (
        db.query(
            sa_func.date(Project.created_at).label("day"),
            sa_func.count(Project.id).label("count"),
        )
        .filter(Project.created_at >= seven_days_ago)
        .group_by(sa_func.date(Project.created_at))
        .all()
    )
    weekly_map = {str(r.day): int(r.count) for r in weekly_rows}
    weekly = []
    for i in range(6, -1, -1):
        day = (now - timedelta(days=i)).date()
        weekly.append({"day": day.isoformat(), "count": weekly_map.get(str(day), 0)})

    # 3) 최근 프로젝트 5개
    recent_projects = (
        db.query(Project).order_by(desc(Project.created_at)).limit(5).all()
    )

    return {
        "total_users": total_users,
        "total_projects": total_projects,
        "total_validations": total_validations,
        "valid_count": valid_count,
        "invalid_count": invalid_count,
        "pass_rate": (valid_count / total_validations * 100) if total_validations else 0.0,
        "weekly": weekly,
        "recent_projects": [
            {
                "id": str(p.id),
                "name": p.name,
                "address": p.address,
                "zone_type": p.zone_type,
                "created_at": p.created_at.isoformat() if p.created_at else None,
            }
            for p in recent_projects
        ],
    }


def list_validation_results_extended(
    db: Session, limit: int = 200
) -> List[Dict[str, Any]]:
    """규정 검토 결과 + 프로젝트명 조인해서 반환."""
    rows = (
        db.query(ValidationResult, Project)
        .join(Project, ValidationResult.project_id == Project.id)
        .order_by(desc(ValidationResult.created_at))
        .limit(limit)
        .all()
    )
    out: List[Dict[str, Any]] = []
    for vr, pr in rows:
        coverage = (vr.building_coverage or {}).get("value")
        height_val = (vr.height_check or {}).get("value_m")
        # far is not stored on validation; fallback to coverage.limit placeholder
        far_val = (vr.building_coverage or {}).get("far")
        out.append(
            {
                "id": str(vr.id),
                "project_id": str(vr.project_id),
                "project_name": pr.name,
                "is_valid": vr.is_valid,
                "coverage": coverage,
                "floor_area_ratio": far_val,
                "height": height_val,
                "zone_type": vr.zone_type,
                "created_at": vr.created_at.isoformat() if vr.created_at else None,
            }
        )
    return out
