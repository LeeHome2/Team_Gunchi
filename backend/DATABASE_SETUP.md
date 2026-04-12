# Database Setup Guide

This guide explains the database layer implementation for the Building Mass Generator API.

## Overview

The database layer is built with:
- **SQLAlchemy 2.0** with `Mapped[]` type hints
- **PostgreSQL** with PostGIS for geospatial data
- **UUID** primary keys for all tables
- **UTC timestamps** for all datetime fields

## File Structure

```
backend/
├── database/
│   ├── __init__.py          # Package exports
│   ├── config.py            # Database configuration and session management
│   ├── models.py            # SQLAlchemy ORM models
│   ├── crud.py              # CRUD operations
│   └── init_db.py           # Database initialization script
├── main.py                  # FastAPI app (integrated with database)
└── ...
```

## Models

### Project (프로젝트)
Base entity for all architectural projects.
- `id` (UUID): Primary key
- `name` (str): Project name
- `address` (str, optional): Project location
- `longitude`, `latitude` (float, optional): Geographic coordinates
- `zone_type` (str, optional): Zone designation (용도지역)
- `created_at`, `updated_at`: Timestamps

### DxfFile (DXF 파일)
Metadata for uploaded DXF files.
- `id` (UUID): Primary key
- `project_id` (UUID): FK to Project
- `original_filename` (str): Original file name
- `stored_path` (str): File storage path
- `file_size` (int): Size in bytes
- `total_entities` (int, optional): Total DXF entities
- `available_layers` (JSON): Layer names ["WALL", "DOOR", ...]
- `footprint` (JSON): Building footprint coordinates [[lon, lat], ...]
- `area_sqm` (float, optional): Plot area in square meters
- `centroid` (JSON): Center point [lon, lat]
- `bounds` (JSON): Bounding box
- `uploaded_at`: Upload timestamp

### ClassificationResult (AI 분류 결과)
Results from AI-based entity classification.
- `id` (UUID): Primary key
- `dxf_file_id` (UUID): FK to DxfFile
- `model_version` (str): AI model version (e.g., "v2.1.0")
- `model_type` (str): "rule_based", "random_forest", "bert"
- `class_counts` (JSON): Entity counts by class {"wall": 400, "door": 30, ...}
- `average_confidence` (float): Mean confidence score
- `total_entities` (int): Number of classified entities
- `processing_time_ms` (int, optional): Processing duration
- `created_at`: Timestamp

### GeneratedModel (3D 모델)
Generated 3D glTF models.
- `id` (UUID): Primary key
- `project_id` (UUID): FK to Project
- `dxf_file_id` (UUID, optional): FK to DxfFile
- `classification_id` (UUID, optional): FK to ClassificationResult
- `model_type` (str): "mass", "wall_mesh", "full"
- `file_path` (str): Path to .glb file
- `file_size` (int, optional): Size in bytes
- `height` (float): Building height in meters
- `floors` (int): Number of floors
- `created_at`: Timestamp

### ValidationResult (배치 검토 결과)
Zoning and placement validation results.
- `id` (UUID): Primary key
- `project_id` (UUID): FK to Project
- `model_id` (UUID): FK to GeneratedModel
- `is_valid` (bool): Overall validation status
- `building_coverage` (JSON): {value, limit, status}
- `setback` (JSON): {min_distance_m, required_m, status}
- `height_check` (JSON): {value_m, limit_m, status}
- `violations` (JSON): [{code, message}, ...]
- `zone_type` (str, optional): Applicable zone
- `created_at`: Timestamp

### SunlightAnalysis (일조 분석)
Sunlight exposure analysis results.
- `id` (UUID): Primary key
- `project_id` (UUID): FK to Project
- `model_id` (UUID, optional): FK to GeneratedModel
- `analysis_date` (date): Analysis reference date
- `grid_spacing` (float): Grid point spacing in meters
- `total_points` (int): Number of analysis points
- `avg_sunlight_hours` (float): Average daily sunlight hours
- `min_sunlight_hours` (float): Minimum
- `max_sunlight_hours` (float): Maximum
- `points_data` (JSON, optional): [{lon, lat, hours}, ...]
- `created_at`: Timestamp

### PlacementOptimization (AI 최적 배치)
AI-based placement optimization results.
- `id` (UUID): Primary key
- `project_id` (UUID): FK to Project
- `model_id` (UUID): FK to GeneratedModel
- `model_version` (str): AI model version
- `total_candidates_evaluated` (int): Number of candidates tested
- `computation_time_ms` (int, optional): Processing time
- `candidates` (JSON): [{rank, placement, total_score, scores, compliance}, ...]
- `weights` (JSON): {orientation, sunlight, circulation, ...}
- `created_at`: Timestamp

### AIModelVersion (AI 모델 버전)
AI model version tracking and activation.
- `id` (UUID): Primary key
- `model_name` (str): "layer_classifier", "placement_optimizer", etc.
- `version` (str): Semantic version (e.g., "v2.1.0")
- `model_type` (str): "random_forest", "bert", "genetic_algorithm"
- `is_active` (bool): Currently active model flag
- `accuracy` (float, optional): Model accuracy metric
- `file_path` (str, optional): Path to model file
- `description` (str, optional): Model description
- `trained_at` (datetime, optional): Training timestamp
- `created_at`: Timestamp

## Environment Setup

### 1. Set DATABASE_URL

Create or update `.env` file:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/building_db
SQL_ECHO=false
DATABASE_POOL=default
```

### 2. Initialize Database

Run the initialization script:

```bash
python database/init_db.py
```

Or from Python:

```python
from database.config import init_db
init_db()
```

The database initializes automatically on FastAPI startup.

## Usage in Endpoints

### Basic Pattern

All endpoints can optionally accept `project_id`, `model_id`, etc. as query parameters to store results:

```python
from fastapi import Depends
from sqlalchemy.orm import Session
from database.config import get_db
from database import crud

@app.post("/api/some-endpoint")
async def some_endpoint(
    request: SomeRequest,
    project_id: str = None,
    db: Session = Depends(get_db)
):
    # ... do work ...

    # Save to database (gracefully handles failures)
    if project_id:
        try:
            import uuid
            project_uuid = uuid.UUID(project_id)
            record = crud.create_something(db=db, project_id=project_uuid, ...)
            logger.info(f"Record saved: {record.id}")
        except Exception as e:
            logger.warning(f"Failed to save: {str(e)}")
            # Continue anyway - API works without DB

    return response
```

### CRUD Operations

All CRUD functions are in `database/crud.py`:

```python
from database import crud

# Projects
project = crud.create_project(db, name="My Project", address="123 Main St")
project = crud.get_project(db, project_id)
projects = crud.get_all_projects(db, skip=0, limit=100)
crud.update_project(db, project_id, name="Updated")
crud.delete_project(db, project_id)

# DXF Files
dxf = crud.create_dxf_file(db, project_id, filename, path, file_size, ...)
dxf = crud.get_dxf_file(db, dxf_id)
dxf_files = crud.get_dxf_files_by_project(db, project_id)

# Classifications
classification = crud.save_classification(
    db, dxf_file_id, "v2.1.0", "random_forest",
    {"wall": 400}, 0.95, 430
)
classification = crud.get_latest_classification(db, dxf_file_id)

# Generated Models
model = crud.save_generated_model(
    db, project_id, "mass", "/path/to/model.glb", 12.0, 4
)
models = crud.get_generated_models_by_project(db, project_id)

# Validation
validation = crud.save_validation_result(
    db, project_id, model_id, True,
    {"value": 45, "limit": 60, "status": "ok"},
    ...
)

# Sunlight Analysis
analysis = crud.save_sunlight_analysis(
    db, project_id, date.today(), 5.0, 100,
    6.5, 4.2, 8.1
)

# Placement Optimization
optimization = crud.save_placement_optimization(
    db, project_id, model_id, "v1.0.0", 50,
    [...], {"orientation": 0.3, "sunlight": 0.4, ...}
)

# AI Model Versions
model_version = crud.create_ai_model_version(
    db, "layer_classifier", "v2.1.0", "random_forest",
    accuracy=0.92
)
active = crud.get_active_model(db, "layer_classifier")
crud.set_active_model(db, model_version_id)
versions = crud.list_model_versions(db, "layer_classifier")
```

## Graceful Fallback

Database operations are designed to fail gracefully:

1. **Startup**: Database initialization happens on app startup, but failures don't crash the app
2. **Endpoints**: All DB saves are wrapped in try-except blocks
3. **Failures**: Logged as warnings; API continues working without DB

This allows the API to function even if:
- Database is temporarily unavailable
- Connection credentials are wrong
- PostgreSQL isn't running

## Database Migrations (Future)

When modifying models, use Alembic:

```bash
pip install alembic
alembic init alembic
alembic revision --autogenerate -m "add new column"
alembic upgrade head
```

## Indexes

Key indexes are created automatically:
- Project: `name`, `created_at`
- DxfFile: `project_id`, `uploaded_at`
- ClassificationResult: `dxf_file_id`, `model_version`, `created_at`
- GeneratedModel: `project_id`, `model_type`, `created_at`
- ValidationResult: `project_id`, `model_id`, `is_valid`
- SunlightAnalysis: `project_id`, `analysis_date`, `created_at`
- PlacementOptimization: `project_id`, `model_id`, `created_at`
- AIModelVersion: `model_name`, `is_active`

## Example: Full Workflow

```python
from database import crud
from sqlalchemy.orm import Session
from uuid import UUID

def full_workflow(db: Session):
    # Create project
    project = crud.create_project(
        db,
        name="Seoul Tower Building",
        address="123 Namsan-ro, Seoul",
        zone_type="상업지역"
    )
    
    # Upload DXF file
    dxf = crud.create_dxf_file(
        db,
        project_id=project.id,
        original_filename="tower.dxf",
        stored_path="/uploads/tower.dxf",
        file_size=2048576,
        footprint=[[126.9, 37.5], [126.905, 37.5], [126.905, 37.505]],
        area_sqm=4500.0,
        centroid=[126.9025, 37.5025]
    )
    
    # Run AI classification
    classification = crud.save_classification(
        db,
        dxf_file_id=dxf.id,
        model_version="v2.1.0",
        model_type="random_forest",
        class_counts={"wall": 420, "door": 35, "window": 60},
        average_confidence=0.92,
        total_entities=515,
        processing_time_ms=1250
    )
    
    # Generate 3D model
    model = crud.save_generated_model(
        db,
        project_id=project.id,
        dxf_file_id=dxf.id,
        classification_id=classification.id,
        model_type="full",
        file_path="/models/model-123.glb",
        height=85.5,
        floors=20,
        file_size=5242880
    )
    
    # Validate placement
    validation = crud.save_validation_result(
        db,
        project_id=project.id,
        model_id=model.id,
        is_valid=True,
        building_coverage={"value": 42.5, "limit": 80, "status": "ok"},
        setback={"min_distance_m": 3.2, "required_m": 1.5, "status": "ok"},
        height_check={"value_m": 85.5, "limit_m": 100, "status": "ok"},
        violations=[],
        zone_type="상업지역"
    )
    
    # Analyze sunlight
    analysis = crud.save_sunlight_analysis(
        db,
        project_id=project.id,
        model_id=model.id,
        analysis_date=date.today(),
        grid_spacing=2.0,
        total_points=250,
        avg_sunlight_hours=6.8,
        min_sunlight_hours=4.1,
        max_sunlight_hours=9.3
    )
    
    # Optimize placement
    optimization = crud.save_placement_optimization(
        db,
        project_id=project.id,
        model_id=model.id,
        model_version="v1.2.0",
        total_candidates_evaluated=1000,
        computation_time_ms=45000,
        candidates=[
            {
                "rank": 1,
                "placement": {"x": 0, "y": 0, "rotation": 0},
                "total_score": 0.92,
                "scores": {"sunlight": 0.95, "orientation": 0.88, "circulation": 0.91},
                "compliance": True
            }
        ],
        weights={"sunlight": 0.4, "orientation": 0.3, "circulation": 0.3}
    )
    
    return {
        "project": project,
        "dxf": dxf,
        "classification": classification,
        "model": model,
        "validation": validation,
        "sunlight": analysis,
        "optimization": optimization
    }
```

## Notes

- All timestamps use UTC (`DateTime(timezone=True)`)
- UUIDs are used for all primary keys for scalability
- JSON columns store structured data without enforcing schema
- Relationships use SQLAlchemy 2.0 style with `Mapped[]` type hints
- Foreign keys use `CASCADE` delete for related records
- Database operations log to the application logger
