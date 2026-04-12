# Database Layer - Quick Start Guide

## Installation (5 minutes)

### 1. Verify Dependencies
```bash
# Check requirements.txt has these
grep -E "sqlalchemy|psycopg2" requirements.txt
# Should show: sqlalchemy==2.0.25, psycopg2-binary
```

### 2. Set Environment Variable
```bash
# Create or update .env file
echo "DATABASE_URL=postgresql://postgres:postgres@localhost:5432/building_db" >> .env
```

### 3. Initialize Database
```bash
# Option A: Automatic (on app startup)
python main.py  # Database tables created automatically

# Option B: Manual
python database/init_db.py
```

That's it! Database is ready.

## Quick Example (2 minutes)

### Create and Query Data
```python
from database import crud
from database.config import SessionLocal
from uuid import UUID

# Get a database session
db = SessionLocal()

# Create a project
project = crud.create_project(
    db,
    name="My Building Project",
    address="123 Main Street"
)
print(f"Created project: {project.id}")

# Get it back
project = crud.get_project(db, project.id)
print(f"Project name: {project.name}")

# Clean up
db.close()
```

## Using in FastAPI Endpoints

### Upload DXF with Database
```python
from fastapi import Depends
from sqlalchemy.orm import Session
from database.config import get_db
from database import crud

@app.post("/api/upload-dxf")
async def upload_dxf(
    file: UploadFile,
    project_id: str = None,
    db: Session = Depends(get_db)
):
    # ... save file ...
    
    # Save to database (optional)
    if project_id:
        dxf_record = crud.create_dxf_file(
            db=db,
            project_id=UUID(project_id),
            original_filename=file.filename,
            stored_path=str(file_path),
            file_size=file_size,
            ...
        )
    
    return {"file_id": "...", "db_record_id": str(dxf_record.id) if dxf_record else None}
```

### Query Data
```python
@app.get("/api/projects/{project_id}")
async def get_project(project_id: str, db: Session = Depends(get_db)):
    project = crud.get_project(db, UUID(project_id))
    if not project:
        raise HTTPException(status_code=404)
    
    # Get all models for this project
    models = crud.get_generated_models_by_project(db, project.id)
    
    return {
        "project": {
            "id": str(project.id),
            "name": project.name,
            "address": project.address,
        },
        "models": [
            {"id": str(m.id), "height": m.height, "floors": m.floors}
            for m in models
        ]
    }
```

## All Available CRUD Functions

### Projects
```python
crud.create_project(db, name, address, longitude, latitude, zone_type)
crud.get_project(db, project_id)
crud.get_all_projects(db, skip=0, limit=100)
crud.update_project(db, project_id, **kwargs)
crud.delete_project(db, project_id)
```

### DXF Files
```python
crud.create_dxf_file(db, project_id, original_filename, stored_path, file_size, ...)
crud.get_dxf_file(db, dxf_file_id)
crud.get_dxf_files_by_project(db, project_id)
crud.delete_dxf_file(db, dxf_file_id)
```

### Classifications
```python
crud.save_classification(db, dxf_file_id, model_version, model_type, class_counts, ...)
crud.get_classification(db, classification_id)
crud.get_latest_classification(db, dxf_file_id)
crud.get_classifications_by_dxf(db, dxf_file_id)
```

### Generated Models
```python
crud.save_generated_model(db, project_id, model_type, file_path, height, floors, ...)
crud.get_generated_model(db, model_id)
crud.get_generated_models_by_project(db, project_id)
crud.delete_generated_model(db, model_id)
```

### Validation Results
```python
crud.save_validation_result(db, project_id, model_id, is_valid, coverage, setback, height, ...)
crud.get_validation_result(db, validation_id)
crud.get_validation_results_by_model(db, model_id)
crud.get_validation_results_by_project(db, project_id)
```

### Sunlight Analysis
```python
crud.save_sunlight_analysis(db, project_id, analysis_date, grid_spacing, total_points, ...)
crud.get_sunlight_analysis(db, analysis_id)
crud.get_sunlight_analyses_by_project(db, project_id)
crud.get_latest_sunlight_analysis(db, project_id)
```

### Placement Optimization
```python
crud.save_placement_optimization(db, project_id, model_id, model_version, candidates, ...)
crud.get_placement_optimization(db, optimization_id)
crud.get_placement_optimizations_by_model(db, model_id)
crud.get_latest_placement_optimization(db, project_id)
```

### AI Model Versions
```python
crud.create_ai_model_version(db, model_name, version, model_type, ...)
crud.get_ai_model_version(db, model_id)
crud.get_active_model(db, model_name)
crud.list_model_versions(db, model_name)
crud.set_active_model(db, model_id)
crud.deactivate_model(db, model_id)
```

## API Usage Examples

### Upload DXF to Project
```bash
curl -X POST http://localhost:8000/api/upload-dxf \
  -F "file=@building.dxf" \
  -F "project_id=550e8400-e29b-41d4-a716-446655440000"
```

### Generate Model for Project
```bash
curl -X POST http://localhost:8000/api/generate-mass \
  -H "Content-Type: application/json" \
  -d '{
    "footprint": [[126.9, 37.5], [126.91, 37.5], [126.91, 37.51]],
    "height": 20,
    "floors": 5,
    "project_id": "550e8400-e29b-41d4-a716-446655440000"
  }'
```

### Validate Placement
```bash
curl -X POST http://localhost:8000/api/validate-placement \
  -H "Content-Type: application/json" \
  -d '{
    "site_footprint": [...],
    "building_footprint": [...],
    "building_height": 20,
    "zone_type": "상업지역",
    "project_id": "550e8400-e29b-41d4-a716-446655440000",
    "model_id": "550e8400-e29b-41d4-a716-446655440001"
  }'
```

## Database Schema Overview

**8 Tables:**
1. `projects` - Base project information
2. `dxf_files` - Uploaded DXF files
3. `classification_results` - AI classification results
4. `generated_models` - 3D models
5. `validation_results` - Zoning validation
6. `sunlight_analyses` - Sunlight exposure data
7. `placement_optimizations` - AI placement optimization
8. `ai_model_versions` - AI model version tracking

**Key Features:**
- UUID primary keys
- UTC timestamps
- JSON columns for flexible data
- Proper foreign key relationships
- Cascade delete
- Indexed for performance

## Troubleshooting

### Database Connection Failed
```python
# Check connection
from database.config import engine
engine.connect()  # Will raise an error if connection fails
```

### Table Already Exists
```python
# Recreate all tables
from database.config import drop_all_tables, init_db
drop_all_tables()  # ⚠️ DELETES ALL DATA
init_db()  # Recreate
```

### See SQL Queries
```bash
# Set SQL_ECHO=true in .env to see actual SQL
export SQL_ECHO=true
python main.py
```

## Full Documentation

- **DATABASE_SETUP.md** - Complete reference
- **DATABASE_EXAMPLES.py** - Working code examples
- **IMPLEMENTATION_SUMMARY.txt** - Implementation details

## Next Steps

1. ✓ Files created and verified
2. ✓ Set up database
3. → Add project management endpoints (optional)
4. → Set up migrations with Alembic (optional)
5. → Add more complex queries as needed

## Support

All database operations include:
- Type hints for IDE autocomplete
- Docstrings explaining parameters
- Error handling with logging
- Graceful fallback if DB unavailable

For detailed information, see DATABASE_SETUP.md
