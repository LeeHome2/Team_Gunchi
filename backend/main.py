"""
CAD 기반 건축 매스 생성 시스템 - Backend (Cesium 버전)
"""

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import os
import uuid
import shutil
from pathlib import Path
from dotenv import load_dotenv

from services.dxf_parser import parse_dxf_file
from services.gltf_exporter import create_building_gltf
from services.coordinate_transform import transform_coordinates
from api.models import (
    ProjectCreate,
    ProjectResponse,
    MassGenerateRequest,
    MassGenerateResponse,
    ValidationRequest,
    ValidationResponse,
)

load_dotenv()

app = FastAPI(
    title="Building Mass Generator API (Cesium)",
    description="CAD 도면 기반 3D 건물 매스 생성 및 일조 분석 API",
    version="1.0.0"
)

# CORS - 개발 환경에서는 모든 origin 허용
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 디렉토리 생성
UPLOAD_DIR = Path("uploads")
MODELS_DIR = Path("models")
UPLOAD_DIR.mkdir(exist_ok=True)
MODELS_DIR.mkdir(exist_ok=True)

# Static files for generated models
app.mount("/models", StaticFiles(directory="models"), name="models")


@app.get("/")
async def root():
    """Root endpoint"""
    return {
        "message": "Building Mass Generator API (Cesium Version)",
        "version": "1.0.0",
        "docs": "/docs"
    }


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy"}


@app.post("/api/upload-dxf")
async def upload_dxf(file: UploadFile = File(...)):
    """
    DXF 파일 업로드 및 파싱

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

        return {
            "success": True,
            "file_id": file_id,
            "site": {
                "footprint": result["footprint"],
                "area_sqm": result["area"],
                "centroid": result["centroid"],
                "bounds": result["bounds"]
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/generate-mass", response_model=MassGenerateResponse)
async def generate_mass(request: MassGenerateRequest):
    """
    3D 건물 매스 glTF 생성

    Args:
        footprint: 건물 바닥면 좌표 [[lon, lat], ...] (경위도)
        height: 건물 높이 (m)
        floors: 층수
        position: 배치 위치 (longitude, latitude)

    Returns:
        생성된 glTF 모델 URL
    """
    import numpy as np

    try:
        model_id = str(uuid.uuid4())
        model_path = MODELS_DIR / f"{model_id}.glb"

        # 경위도 좌표를 로컬 미터 좌표로 변환
        footprint_lonlat = np.array(request.footprint)
        centroid = footprint_lonlat.mean(axis=0)

        # 경위도 -> 미터 변환 계수
        lat_rad = np.radians(centroid[1])
        meters_per_deg_lat = 111320  # 위도 1도당 미터
        meters_per_deg_lon = 111320 * np.cos(lat_rad)  # 경도 1도당 미터 (위도에 따라 다름)

        # 중심점 기준 로컬 좌표 (미터)
        footprint_meters = []
        for lon, lat in request.footprint:
            x = (lon - centroid[0]) * meters_per_deg_lon
            y = (lat - centroid[1]) * meters_per_deg_lat
            footprint_meters.append([x, y])

        print(f"Footprint converted: {request.footprint} -> {footprint_meters}")
        print(f"Building size: {max(p[0] for p in footprint_meters) - min(p[0] for p in footprint_meters):.1f}m x {max(p[1] for p in footprint_meters) - min(p[1] for p in footprint_meters):.1f}m")

        # glTF 생성 (미터 단위 좌표 사용)
        create_building_gltf(
            footprint=footprint_meters,
            height=request.height,
            output_path=str(model_path)
        )

        return MassGenerateResponse(
            success=True,
            model_id=model_id,
            model_url=f"/models/{model_id}.glb",
            height=request.height,
            floors=request.floors
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/validate-placement", response_model=ValidationResponse)
async def validate_placement(request: ValidationRequest):
    """
    건축 배치 규정 검토

    검토 항목:
    - 건폐율: (건축면적/대지면적) × 100
    - 이격거리: 대지경계선~건물 최소 거리
    - 높이제한: 최고 높이 검증
    """
    from shapely.geometry import Polygon
    from shapely.ops import nearest_points

    try:
        site_polygon = Polygon(request.site_footprint)
        building_polygon = Polygon(request.building_footprint)

        site_area = site_polygon.area
        building_area = building_polygon.area

        # 건폐율 계산
        building_coverage = (building_area / site_area) * 100
        coverage_limit = request.coverage_limit or 60.0
        coverage_ok = building_coverage <= coverage_limit

        # 이격거리 계산
        site_boundary = site_polygon.exterior
        building_boundary = building_polygon.exterior
        min_distance = site_boundary.distance(building_boundary)
        setback_required = request.setback_required or 1.5
        setback_ok = min_distance >= setback_required

        # 높이 검토
        height_limit = request.height_limit or 12.0
        height_ok = request.building_height <= height_limit

        # 위반 사항 수집
        violations = []
        if not coverage_ok:
            violations.append({
                "code": "BCR_EXCEED",
                "message": f"건폐율 {coverage_limit}% 초과 (현재 {building_coverage:.1f}%)"
            })
        if not setback_ok:
            violations.append({
                "code": "SETBACK_VIOLATION",
                "message": f"이격거리 부족 (필요 {setback_required}m, 현재 {min_distance:.2f}m)"
            })
        if not height_ok:
            violations.append({
                "code": "HEIGHT_EXCEED",
                "message": f"높이제한 {height_limit}m 초과 (현재 {request.building_height}m)"
            })

        return ValidationResponse(
            is_valid=len(violations) == 0,
            building_coverage={
                "value": round(building_coverage, 1),
                "limit": coverage_limit,
                "status": "OK" if coverage_ok else "VIOLATION"
            },
            setback={
                "min_distance_m": round(min_distance, 2),
                "required_m": setback_required,
                "status": "OK" if setback_ok else "VIOLATION"
            },
            height={
                "value_m": request.building_height,
                "limit_m": height_limit,
                "status": "OK" if height_ok else "VIOLATION"
            },
            violations=violations
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/models/{model_id}.glb")
async def get_model(model_id: str):
    """glTF 모델 파일 다운로드"""
    model_path = MODELS_DIR / f"{model_id}.glb"

    if not model_path.exists():
        raise HTTPException(status_code=404, detail="모델을 찾을 수 없습니다")

    return FileResponse(
        path=model_path,
        media_type="model/gltf-binary",
        filename=f"{model_id}.glb"
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=os.getenv("BACKEND_HOST", "0.0.0.0"),
        port=int(os.getenv("BACKEND_PORT", 8000)),
        reload=True
    )
