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


class MassGenerateResponse(BaseModel):
    """3D 매스 생성 응답"""
    success: bool
    model_id: str
    model_url: str
    height: float
    floors: int
    mesh_stats: Optional[MeshStats] = None
    bounding_box: Optional[BoundingBox] = None


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


# ─── 결과 보고서 (docx) 생성 ─────────────────────────────
class ReportMeta(BaseModel):
    generated_at: Optional[str] = None
    author: Optional[str] = None


class ReportProject(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    longitude: Optional[float] = None
    latitude: Optional[float] = None
    zone_type: Optional[str] = None


class ReportSiteBounds(BaseModel):
    min_x: Optional[float] = None
    max_x: Optional[float] = None
    min_y: Optional[float] = None
    max_y: Optional[float] = None


class ReportSite(BaseModel):
    area_m2: Optional[float] = None
    vertex_count: Optional[int] = None
    bounds: Optional[ReportSiteBounds] = None
    centroid_longitude: Optional[float] = None
    centroid_latitude: Optional[float] = None


class ReportBuilding(BaseModel):
    footprint_area_m2: Optional[float] = None
    height_m: Optional[float] = None
    floors: Optional[int] = None
    rotation_deg: Optional[float] = None
    position_longitude: Optional[float] = None
    position_latitude: Optional[float] = None
    mesh_stats: Optional[MeshStats] = None


class ReportCheckItem(BaseModel):
    value: Optional[float] = None
    limit: Optional[float] = None
    status: Optional[str] = None  # pass | fail | warning


class ReportSetbackItem(BaseModel):
    min_distance_m: Optional[float] = None
    required_m: Optional[float] = None
    status: Optional[str] = None


class ReportHeightItem(BaseModel):
    value_m: Optional[float] = None
    limit_m: Optional[float] = None
    status: Optional[str] = None


class ReportDaylightItem(BaseModel):
    value_m: Optional[float] = None
    required_m: Optional[float] = None
    status: Optional[str] = None


class ReportValidation(BaseModel):
    is_valid: Optional[bool] = None
    building_coverage: Optional[ReportCheckItem] = None
    setback: Optional[ReportSetbackItem] = None
    height: Optional[ReportHeightItem] = None
    daylight: Optional[ReportDaylightItem] = None
    violations: Optional[List[ViolationItem]] = None


class ReportPipeline(BaseModel):
    parsed_entities: Optional[int] = None
    classified_layers: Optional[int] = None
    classifier_model: Optional[str] = None
    glb_size_bytes: Optional[int] = None
    placement_applied: Optional[bool] = None
    validation_applied: Optional[bool] = None


class ReportRequest(BaseModel):
    """결과 보고서 생성 요청 (REPORT_SCHEMA.md 참고)"""
    meta: Optional[ReportMeta] = None
    project: Optional[ReportProject] = None
    site: Optional[ReportSite] = None
    building: Optional[ReportBuilding] = None
    validation: Optional[ReportValidation] = None
    pipeline: Optional[ReportPipeline] = None


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
