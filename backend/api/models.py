"""
API Request/Response 모델 정의
"""

from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any


# ─── 인증 (Auth) ───────────────────────────────────────────
class SignupRequest(BaseModel):
    """회원가입 요청"""
    name: str = Field(..., description="사용자 이름")
    email: str = Field(..., description="이메일")
    password: str = Field(..., description="비밀번호", min_length=4)


class LoginRequest(BaseModel):
    """로그인 요청"""
    email: str = Field(..., description="이메일")
    password: str = Field(..., description="비밀번호")


class AuthResponse(BaseModel):
    """인증 응답"""
    success: bool
    user_id: Optional[str] = None
    name: Optional[str] = None
    email: Optional[str] = None
    message: Optional[str] = None


# ─── 프로젝트 ───────────────────────────────────────────────
class ProjectCreate(BaseModel):
    """프로젝트 생성 요청"""
    name: str = Field(..., description="프로젝트 이름")
    address: Optional[str] = Field(None, description="주소")
    user_id: Optional[str] = Field(None, description="소유자 ID")


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
    # 벽체 기반 생성 옵션
    file_id: Optional[str] = Field(
        None,
        description="DXF 파일 ID (벽 레이어 기반 생성 시 필수)"
    )
    wall_layers: Optional[List[str]] = Field(
        None,
        description="벽 레이어 이름 목록 (제공 시 벽체 형태로 생성)"
    )
    wall_thickness: float = Field(
        default=0.15,
        description="벽 두께 (m)",
        ge=0.05,
        le=1.0
    )


class MeshStats(BaseModel):
    """매스 생성 결과의 메쉬 통계 (변환과정 확인 모달에 표시)"""
    wall_meshes: int
    vertices: int
    faces: int


class BoundingBox(BaseModel):
    """모델 바운딩 박스 (미터 단위, 원점 중심)"""
    width: float = Field(description="X축 너비 (m)")
    depth: float = Field(description="Z축 깊이 (m)")
    height: float = Field(description="Y축 높이 (m)")


class BuildStep(BaseModel):
    """변환 과정 단계"""
    label: str
    detail: str


class MassGenerateResponse(BaseModel):
    """3D 매스 생성 응답"""
    success: bool
    model_id: str
    model_url: str
    height: float
    floors: int
    mesh_stats: Optional[MeshStats] = None
    bounding_box: Optional[BoundingBox] = None
    build_steps: Optional[List[BuildStep]] = None


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
    zone_type: Optional[str] = Field(
        default=None,
        description="용도지역 (예: 제1종일반주거지역) - 지정 시 자동으로 규정 적용"
    )
    coverage_limit: Optional[float] = Field(
        default=None,
        description="건폐율 한도 (%) - zone_type 미지정 시 사용"
    )
    setback_required: Optional[float] = Field(
        default=None,
        description="필요 이격거리 (m) - zone_type 미지정 시 사용"
    )
    height_limit: Optional[float] = Field(
        default=None,
        description="높이 한도 (m) - zone_type 미지정 시 사용"
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


# ─── 주차구역 (Parking Zone) ───────────────────────────────

class ParkingRequirementRequest(BaseModel):
    """필요 주차 대수 산정 요청"""
    building_use: str = Field(..., description="건물 용도 (예: 근린생활시설, 업무시설)")
    gross_floor_area_m2: float = Field(..., description="연면적 (m²)", gt=0)
    ramp: bool = Field(default=False, description="자주식(경사로) 주차 여부")


class ParkingRequirementResponse(BaseModel):
    """필요 주차 대수 산정 결과"""
    building_use: str
    gross_floor_area_m2: float
    ratio_area_m2: float
    ratio_count: int
    required_total: int
    required_disabled: int
    required_standard: int
    ramp_extra_factor: float
    note: str


class ParkingLayoutRequest(BaseModel):
    """주차구역 자동 배치 요청"""
    site_footprint: List[List[float]] = Field(
        ..., description="대지 경계 좌표 (로컬 m) [[x,y], ...]"
    )
    building_footprint: List[List[float]] = Field(
        ..., description="건물 footprint 좌표 (로컬 m)"
    )
    required_total: int = Field(..., description="필요 총 주차 대수", ge=1)
    required_disabled: int = Field(default=1, description="장애인 전용 대수", ge=0)
    road_lines: Optional[List[List[List[float]]]] = Field(
        default=None, description="도로 중심선 [[[x,y], ...], ...]"
    )
    preferred_heading: float = Field(default=0.0, description="선호 주차구역 방향 (°)")


class ParkingSlotResponse(BaseModel):
    """주차 슬롯"""
    id: int
    slot_type: str
    cx: float
    cy: float
    width: float
    depth: float
    heading: float
    polygon: List[List[float]]


class ParkingAisleResponse(BaseModel):
    """차로"""
    polygon: List[List[float]]
    direction: str


class AccessPointResponse(BaseModel):
    """진입로"""
    x: float
    y: float
    road_x: Optional[float] = None
    road_y: Optional[float] = None
    width: float


class ParkingLayoutResponse(BaseModel):
    """주차구역 자동 배치 결과"""
    slots: List[ParkingSlotResponse]
    aisles: List[ParkingAisleResponse]
    access_point: Optional[AccessPointResponse] = None
    zone_polygon: List[List[float]]
    zone_center: List[float]
    zone_rotation: float
    zone_width: float
    zone_depth: float
    total_slots: int
    standard_slots: int
    disabled_slots: int
    total_area_m2: float
    parking_area_ratio: float
    warnings: List[str]


# ─── AI 스코어링 ──────────────────────────────────────────

class AIScoringRequest(BaseModel):
    """AI 스코어링 요청 — 배치검토·주차·일조 결과를 종합 평가"""
    validation: Optional[Dict[str, Any]] = Field(
        None,
        description="배치 검토 결과 (building_coverage, setback, height, violations)"
    )
    parking: Optional[Dict[str, Any]] = Field(
        None,
        description="주차 분석 결과 (required_total, placed_total, ...)"
    )
    sunlight: Optional[Dict[str, Any]] = Field(
        None,
        description="일조 분석 결과 (avg/min/max_sunlight_hours, total_points)"
    )


class AIScoringResponse(BaseModel):
    """AI 스코어링 응답"""
    success: bool
    category_grades: Dict[str, str] = Field(
        description="항목별 등급 {'건폐율':'A', '이격거리':'B', ...}"
    )
    overall_score: int = Field(description="종합 점수 0~100")
    summary: str = Field(description="종합 평가 요약")
    suggestions: str = Field(description="구체적 개선 제안")
    source: str = Field(description="'llm' 또는 'fallback'")
    error: Optional[str] = None
