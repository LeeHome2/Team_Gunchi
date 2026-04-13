"""
SQLAlchemy ORM Models for Building Mass Generator
Using SQLAlchemy 2.0 with Mapped[] type hints
"""

from sqlalchemy import (
    Column, String, Float, Integer, DateTime, Boolean, JSON, ForeignKey,
    Index, Text, Date, func, Uuid
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from datetime import datetime, date
from uuid import uuid4, UUID
from typing import Optional, List, Dict, Any

from .config import Base


class Project(Base):
    """
    프로젝트 테이블
    건축 프로젝트의 기본 정보를 저장
    """
    __tablename__ = "projects"

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    user_id: Mapped[Optional[UUID]] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True
    )  # 프로젝트 소유자
    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    address: Mapped[Optional[str]] = mapped_column(String(500))
    longitude: Mapped[Optional[float]] = mapped_column(Float)
    latitude: Mapped[Optional[float]] = mapped_column(Float)
    zone_type: Mapped[Optional[str]] = mapped_column(String(100))  # 용도지역
    state_data: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON)  # 에디터 전체 상태 (저장/불러오기)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False
    )

    # Relationships
    user: Mapped[Optional["User"]] = relationship(back_populates="projects")
    dxf_files: Mapped[List["DxfFile"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    generated_models: Mapped[List["GeneratedModel"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    validation_results: Mapped[List["ValidationResult"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    sunlight_analyses: Mapped[List["SunlightAnalysis"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    placement_optimizations: Mapped[List["PlacementOptimization"]] = relationship(back_populates="project", cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_project_name", "name"),
        Index("idx_project_created", "created_at"),
        Index("idx_project_user", "user_id"),
    )


class DxfFile(Base):
    """
    DXF 파일 테이블
    업로드된 DXF 파일의 메타데이터 저장
    """
    __tablename__ = "dxf_files"

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    project_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    stored_path: Mapped[str] = mapped_column(String(500), nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)  # bytes
    total_entities: Mapped[Optional[int]] = mapped_column(Integer)
    available_layers: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON)  # ["WALL", "DOOR", ...]
    footprint: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON)  # [[lon, lat], ...]
    area_sqm: Mapped[Optional[float]] = mapped_column(Float)
    centroid: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON)  # [lon, lat]
    bounds: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON)  # {min_x, min_y, max_x, max_y}
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    project: Mapped["Project"] = relationship(back_populates="dxf_files")
    classification_results: Mapped[List["ClassificationResult"]] = relationship(back_populates="dxf_file", cascade="all, delete-orphan")
    generated_models: Mapped[List["GeneratedModel"]] = relationship(back_populates="dxf_file", cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_dxf_project", "project_id"),
        Index("idx_dxf_uploaded", "uploaded_at"),
    )


class ClassificationResult(Base):
    """
    AI 분류 결과 테이블
    DXF 엔티티의 AI 기반 분류 결과 저장
    """
    __tablename__ = "classification_results"

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    dxf_file_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("dxf_files.id"), nullable=False)
    model_version: Mapped[str] = mapped_column(String(50), nullable=False)  # e.g., "v2.1.0"
    model_type: Mapped[str] = mapped_column(String(50), nullable=False)  # "rule_based" | "random_forest" | "bert"
    class_counts: Mapped[Dict[str, Any]] = mapped_column(JSON, nullable=False)  # {"wall": 400, "door": 30, ...}
    average_confidence: Mapped[float] = mapped_column(Float, nullable=False)
    total_entities: Mapped[int] = mapped_column(Integer, nullable=False)
    processing_time_ms: Mapped[Optional[int]] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    dxf_file: Mapped["DxfFile"] = relationship(back_populates="classification_results")
    generated_models: Mapped[List["GeneratedModel"]] = relationship(back_populates="classification")

    __table_args__ = (
        Index("idx_classification_dxf", "dxf_file_id"),
        Index("idx_classification_model", "model_version"),
        Index("idx_classification_created", "created_at"),
    )


class GeneratedModel(Base):
    """
    3D 모델 테이블
    생성된 glTF 모델 파일의 메타데이터
    """
    __tablename__ = "generated_models"

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    project_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    dxf_file_id: Mapped[Optional[UUID]] = mapped_column(Uuid(as_uuid=True), ForeignKey("dxf_files.id"))
    classification_id: Mapped[Optional[UUID]] = mapped_column(Uuid(as_uuid=True), ForeignKey("classification_results.id"))
    model_type: Mapped[str] = mapped_column(String(50), nullable=False)  # "mass" | "wall_mesh" | "full"
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)
    file_size: Mapped[Optional[int]] = mapped_column(Integer)  # bytes
    height: Mapped[float] = mapped_column(Float, nullable=False)  # meters
    floors: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    project: Mapped["Project"] = relationship(back_populates="generated_models")
    dxf_file: Mapped[Optional["DxfFile"]] = relationship(back_populates="generated_models")
    classification: Mapped[Optional["ClassificationResult"]] = relationship(back_populates="generated_models")
    validation_results: Mapped[List["ValidationResult"]] = relationship(back_populates="model", cascade="all, delete-orphan")
    sunlight_analyses: Mapped[List["SunlightAnalysis"]] = relationship(back_populates="model", cascade="all, delete-orphan")
    placement_optimizations: Mapped[List["PlacementOptimization"]] = relationship(back_populates="model", cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_model_project", "project_id"),
        Index("idx_model_type", "model_type"),
        Index("idx_model_created", "created_at"),
    )


class ValidationResult(Base):
    """
    배치 검토 결과 테이블
    건축 배치 규정 검토 결과 저장
    """
    __tablename__ = "validation_results"

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    project_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    model_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("generated_models.id"), nullable=False)
    is_valid: Mapped[bool] = mapped_column(Boolean, nullable=False)
    building_coverage: Mapped[Dict[str, Any]] = mapped_column(JSON, nullable=False)  # {value, limit, status}
    setback: Mapped[Dict[str, Any]] = mapped_column(JSON, nullable=False)  # {min_distance_m, required_m, status}
    height_check: Mapped[Dict[str, Any]] = mapped_column(JSON, nullable=False)  # {value_m, limit_m, status}
    violations: Mapped[Dict[str, Any]] = mapped_column(JSON, nullable=False)  # [{code, message}, ...]
    zone_type: Mapped[Optional[str]] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    project: Mapped["Project"] = relationship(back_populates="validation_results")
    model: Mapped["GeneratedModel"] = relationship(back_populates="validation_results")

    __table_args__ = (
        Index("idx_validation_project", "project_id"),
        Index("idx_validation_model", "model_id"),
        Index("idx_validation_valid", "is_valid"),
    )


class SunlightAnalysis(Base):
    """
    일조 분석 결과 테이블
    일조량 분석 데이터 저장
    """
    __tablename__ = "sunlight_analyses"

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    project_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    model_id: Mapped[Optional[UUID]] = mapped_column(Uuid(as_uuid=True), ForeignKey("generated_models.id"))
    analysis_date: Mapped[date] = mapped_column(Date, nullable=False)  # 분석 기준일
    grid_spacing: Mapped[float] = mapped_column(Float, nullable=False)  # 미터
    total_points: Mapped[int] = mapped_column(Integer, nullable=False)
    avg_sunlight_hours: Mapped[float] = mapped_column(Float, nullable=False)
    min_sunlight_hours: Mapped[float] = mapped_column(Float, nullable=False)
    max_sunlight_hours: Mapped[float] = mapped_column(Float, nullable=False)
    points_data: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON)  # [{lon, lat, hours}, ...] - 큰 데이터
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    project: Mapped["Project"] = relationship(back_populates="sunlight_analyses")
    model: Mapped[Optional["GeneratedModel"]] = relationship(back_populates="sunlight_analyses")

    __table_args__ = (
        Index("idx_sunlight_project", "project_id"),
        Index("idx_sunlight_date", "analysis_date"),
        Index("idx_sunlight_created", "created_at"),
    )


class PlacementOptimization(Base):
    """
    AI 최적 배치 결과 테이블
    AI 기반 건축물 배치 최적화 결과 저장
    """
    __tablename__ = "placement_optimizations"

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    project_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    model_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("generated_models.id"), nullable=False)
    model_version: Mapped[str] = mapped_column(String(50), nullable=False)  # AI 모델 버전
    total_candidates_evaluated: Mapped[int] = mapped_column(Integer, nullable=False)
    computation_time_ms: Mapped[Optional[int]] = mapped_column(Integer)
    candidates: Mapped[Dict[str, Any]] = mapped_column(JSON, nullable=False)  # [{rank, placement, total_score, scores, compliance}, ...]
    weights: Mapped[Dict[str, Any]] = mapped_column(JSON, nullable=False)  # {orientation, sunlight, circulation, ...}
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    project: Mapped["Project"] = relationship(back_populates="placement_optimizations")
    model: Mapped["GeneratedModel"] = relationship(back_populates="placement_optimizations")

    __table_args__ = (
        Index("idx_placement_project", "project_id"),
        Index("idx_placement_model", "model_id"),
        Index("idx_placement_created", "created_at"),
    )


class AIModelVersion(Base):
    """
    AI 모델 버전 관리 테이블
    배포된 AI 모델의 버전 관리
    """
    __tablename__ = "ai_model_versions"

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    model_name: Mapped[str] = mapped_column(String(100), nullable=False, index=True)  # "layer_classifier" | "placement_optimizer"
    version: Mapped[str] = mapped_column(String(50), nullable=False)  # "v2.1.0"
    model_type: Mapped[str] = mapped_column(String(50), nullable=False)  # "random_forest" | "bert" | "genetic_algorithm"
    is_active: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)  # 현재 활성 모델
    accuracy: Mapped[Optional[float]] = mapped_column(Float)
    file_path: Mapped[Optional[str]] = mapped_column(String(500))
    description: Mapped[Optional[str]] = mapped_column(Text)
    trained_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("idx_model_name", "model_name"),
        Index("idx_model_active", "is_active"),
        Index("idx_model_version", "model_name", "version"),
    )


# ============================================================================
# ADMIN CONSOLE TABLES
# ============================================================================


class User(Base):
    """
    서비스 사용자 계정 (일반 사용자).
    관리자 콘솔의 '사용자 관리'에서 조회/제어한다.
    """
    __tablename__ = "users"

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    password_hash: Mapped[Optional[str]] = mapped_column(String(255))  # 비밀번호 해시
    # "active" | "pending" | "suspended"
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active", index=True)
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    last_login_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    project_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Relationships
    projects: Mapped[List["Project"]] = relationship(back_populates="user")

    __table_args__ = (
        Index("idx_users_status", "status"),
        Index("idx_users_joined", "joined_at"),
    )


class AdminAccount(Base):
    """
    관리자 계정 (콘솔 접근 권한).
    """
    __tablename__ = "admin_accounts"

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    email: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    # "superadmin" | "ops" | "viewer"
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="viewer")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_login_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class ApiKey(Base):
    """
    발급된 API 키 메타데이터.
    실제 키 값은 저장하지 않고 prefix만 노출한다.
    """
    __tablename__ = "api_keys"

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    prefix: Mapped[str] = mapped_column(String(40), nullable=False)  # e.g. "sk_live_a8f2…"
    key_hash: Mapped[Optional[str]] = mapped_column(String(128))
    environment: Mapped[str] = mapped_column(String(20), default="live", nullable=False)  # "live" | "test"
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    last_used_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        Index("idx_api_keys_active", "is_active"),
    )


class RegulationBaseRule(Base):
    """
    기본 규정 기준값 (건폐율·용적률·이격·높이 등).
    지역별 규정이 없을 때 적용되는 디폴트.
    """
    __tablename__ = "regulation_base_rules"

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    key: Mapped[str] = mapped_column(String(40), nullable=False, unique=True)
    label: Mapped[str] = mapped_column(String(100), nullable=False)
    unit: Mapped[str] = mapped_column(String(10), nullable=False)
    value: Mapped[float] = mapped_column(Float, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class RegulationZoneRule(Base):
    """
    지역/용도지역별 규정 세부 값.
    """
    __tablename__ = "regulation_zone_rules"

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    zone: Mapped[str] = mapped_column(String(100), nullable=False)  # 용도지역
    region: Mapped[str] = mapped_column(String(100), nullable=False)  # 적용지역
    coverage: Mapped[float] = mapped_column(Float, nullable=False)  # 건폐율 %
    far: Mapped[float] = mapped_column(Float, nullable=False)  # 용적률 %
    height_max: Mapped[float] = mapped_column(Float, nullable=False)  # 최고 높이 m
    setback: Mapped[float] = mapped_column(Float, nullable=False)  # 이격 m
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    __table_args__ = (
        Index("idx_zone_rules_zone_region", "zone", "region"),
    )


class ServiceSetting(Base):
    """
    서비스 설정 key-value 스토어.
    API URL, rate limit, 로그 레벨 등 운영 파라미터 저장.
    """
    __tablename__ = "service_settings"

    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
