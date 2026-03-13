"""
API Request/Response 모델 정의
"""

from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any


class ProjectCreate(BaseModel):
    """프로젝트 생성 요청"""
    name: str = Field(..., description="프로젝트 이름")
    address: Optional[str] = Field(None, description="주소")


class ProjectResponse(BaseModel):
    """프로젝트 응답"""
    id: str
    name: str
    address: Optional[str]
    status: str


class MassGenerateRequest(BaseModel):
    """3D 매스 생성 요청"""
    footprint: List[List[float]] = Field(
        ...,
        description="건물 바닥면 좌표 [[x, y], ...]"
    )
    height: float = Field(
        default=9.0,
        description="건물 높이 (m)",
        ge=1.0,
        le=100.0
    )
    floors: int = Field(
        default=3,
        description="층수",
        ge=1,
        le=30
    )
    position: Optional[List[float]] = Field(
        None,
        description="배치 위치 [longitude, latitude]"
    )


class MassGenerateResponse(BaseModel):
    """3D 매스 생성 응답"""
    success: bool
    model_id: str
    model_url: str
    height: float
    floors: int


class ValidationRequest(BaseModel):
    """배치 검토 요청"""
    site_footprint: List[List[float]] = Field(
        ...,
        description="대지 경계 좌표"
    )
    building_footprint: List[List[float]] = Field(
        ...,
        description="건물 바닥면 좌표"
    )
    building_height: float = Field(
        default=9.0,
        description="건물 높이 (m)"
    )
    coverage_limit: Optional[float] = Field(
        default=60.0,
        description="건폐율 한도 (%)"
    )
    setback_required: Optional[float] = Field(
        default=1.5,
        description="필요 이격거리 (m)"
    )
    height_limit: Optional[float] = Field(
        default=12.0,
        description="높이 한도 (m)"
    )


class ValidationItem(BaseModel):
    """검토 항목"""
    value: float
    limit: float
    status: str


class SetbackItem(BaseModel):
    """이격거리 검토"""
    min_distance_m: float
    required_m: float
    status: str


class HeightItem(BaseModel):
    """높이 검토"""
    value_m: float
    limit_m: float
    status: str


class ViolationItem(BaseModel):
    """위반 항목"""
    code: str
    message: str


class ValidationResponse(BaseModel):
    """배치 검토 응답"""
    is_valid: bool
    building_coverage: Dict[str, Any]
    setback: Dict[str, Any]
    height: Dict[str, Any]
    violations: List[ViolationItem]
