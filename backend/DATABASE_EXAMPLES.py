"""
DATABASE INTEGRATION EXAMPLES
Quick reference for using the database layer
"""

from sqlalchemy.orm import Session
from uuid import UUID
from datetime import date
from database.config import get_db, SessionLocal
from database import crud


# ============================================================================
# EXAMPLE 1: Create a complete project workflow
# ============================================================================

def create_project_workflow():
    """
    Complete workflow: Project -> DXF Upload -> Classification -> Model -> Validation
    """
    db = SessionLocal()
    try:
        # Create a project
        project = crud.create_project(
            db,
            name="Seoul Business Center",
            address="Seoul, South Korea",
            longitude=126.9250,
            latitude=37.5025,
            zone_type="상업지역"
        )
        print(f"✓ Created project: {project.id}")

        # Upload DXF file
        dxf_file = crud.create_dxf_file(
            db,
            project_id=project.id,
            original_filename="building_plan.dxf",
            stored_path="/uploads/file123.dxf",
            file_size=2048576,
            total_entities=450,
            available_layers=["WALL", "DOOR", "WINDOW", "COLUMN"],
            footprint=[[126.920, 37.500], [126.930, 37.500], [126.930, 37.510], [126.920, 37.510]],
            area_sqm=10000.0,
            centroid=[126.925, 37.505],
            bounds={"min_x": 126.920, "min_y": 37.500, "max_x": 126.930, "max_y": 37.510}
        )
        print(f"✓ Uploaded DXF: {dxf_file.id}")

        # Save AI classification result
        classification = crud.save_classification(
            db,
            dxf_file_id=dxf_file.id,
            model_version="v2.1.0",
            model_type="random_forest",
            class_counts={"wall": 420, "door": 35, "window": 60, "column": 25},
            average_confidence=0.925,
            total_entities=450,
            processing_time_ms=1250
        )
        print(f"✓ Classified entities: {classification.id}")

        # Generate 3D model
        generated_model = crud.save_generated_model(
            db,
            project_id=project.id,
            dxf_file_id=dxf_file.id,
            classification_id=classification.id,
            model_type="full",
            file_path="/models/model_abc123.glb",
            height=85.5,
            floors=20,
            file_size=5242880
        )
        print(f"✓ Generated model: {generated_model.id}")

        # Validate placement
        validation = crud.save_validation_result(
            db,
            project_id=project.id,
            model_id=generated_model.id,
            is_valid=True,
            building_coverage={"value": 42.5, "limit": 80.0, "status": "pass"},
            setback={"min_distance_m": 3.2, "required_m": 1.5, "status": "pass"},
            height_check={"value_m": 85.5, "limit_m": 100.0, "status": "pass"},
            violations=[],
            zone_type="상업지역"
        )
        print(f"✓ Validated placement: {validation.id}")

        # Analyze sunlight
        sunlight = crud.save_sunlight_analysis(
            db,
            project_id=project.id,
            model_id=generated_model.id,
            analysis_date=date.today(),
            grid_spacing=2.0,
            total_points=250,
            avg_sunlight_hours=6.8,
            min_sunlight_hours=4.1,
            max_sunlight_hours=9.3,
            points_data=None  # Could include detailed point data
        )
        print(f"✓ Analyzed sunlight: {sunlight.id}")

        # Optimize placement
        optimization = crud.save_placement_optimization(
            db,
            project_id=project.id,
            model_id=generated_model.id,
            model_version="v1.2.0",
            total_candidates_evaluated=1000,
            computation_time_ms=45000,
            candidates=[
                {
                    "rank": 1,
                    "placement": {"x": 0, "y": 0, "rotation": 0},
                    "total_score": 0.92,
                    "scores": {
                        "sunlight": 0.95,
                        "orientation": 0.88,
                        "circulation": 0.91
                    },
                    "compliance": True
                },
                {
                    "rank": 2,
                    "placement": {"x": 5, "y": 0, "rotation": 45},
                    "total_score": 0.88,
                    "scores": {
                        "sunlight": 0.92,
                        "orientation": 0.84,
                        "circulation": 0.87
                    },
                    "compliance": True
                }
            ],
            weights={"sunlight": 0.4, "orientation": 0.3, "circulation": 0.3}
        )
        print(f"✓ Optimized placement: {optimization.id}")

        # Return all IDs for reference
        return {
            "project_id": str(project.id),
            "dxf_file_id": str(dxf_file.id),
            "classification_id": str(classification.id),
            "model_id": str(generated_model.id),
            "validation_id": str(validation.id),
            "sunlight_id": str(sunlight.id),
            "optimization_id": str(optimization.id),
        }

    finally:
        db.close()


# ============================================================================
# EXAMPLE 2: Query project with all related data
# ============================================================================

def query_project_details(project_id: str):
    """
    Fetch a project and all its related data
    """
    db = SessionLocal()
    try:
        # Get project
        project = crud.get_project(db, UUID(project_id))
        if not project:
            return {"error": "Project not found"}

        # Get all DXF files
        dxf_files = crud.get_dxf_files_by_project(db, project.id)

        # Get all models
        models = crud.get_generated_models_by_project(db, project.id)

        # Get all validation results
        validations = crud.get_validation_results_by_project(db, project.id)

        # Get latest sunlight analysis
        latest_sunlight = crud.get_latest_sunlight_analysis(db, project.id)

        # Get latest placement optimization
        latest_optimization = crud.get_latest_placement_optimization(db, project.id)

        return {
            "project": {
                "id": str(project.id),
                "name": project.name,
                "address": project.address,
                "zone_type": project.zone_type,
                "created_at": project.created_at.isoformat(),
            },
            "dxf_files": [
                {"id": str(d.id), "filename": d.original_filename}
                for d in dxf_files
            ],
            "models": [
                {
                    "id": str(m.id),
                    "type": m.model_type,
                    "height": m.height,
                    "floors": m.floors
                }
                for m in models
            ],
            "validations": [
                {
                    "id": str(v.id),
                    "is_valid": v.is_valid,
                    "created_at": v.created_at.isoformat()
                }
                for v in validations
            ],
            "latest_sunlight": {
                "id": str(latest_sunlight.id),
                "avg_hours": latest_sunlight.avg_sunlight_hours
            } if latest_sunlight else None,
            "latest_optimization": {
                "id": str(latest_optimization.id),
                "candidates": len(latest_optimization.candidates)
            } if latest_optimization else None,
        }

    finally:
        db.close()


# ============================================================================
# EXAMPLE 3: Manage AI model versions
# ============================================================================

def manage_ai_models():
    """
    Create and manage AI model versions
    """
    db = SessionLocal()
    try:
        # Create new model version
        new_model = crud.create_ai_model_version(
            db,
            model_name="layer_classifier",
            version="v2.2.0",
            model_type="random_forest",
            accuracy=0.945,
            file_path="/models/classifier_v2.2.0.pkl",
            description="Improved random forest with balanced training data",
            trained_at=None  # Will be set when training completes
        )
        print(f"✓ Created model version: {new_model.id}")

        # List all versions of a model
        versions = crud.list_model_versions(db, "layer_classifier")
        print(f"✓ Found {len(versions)} versions")
        for v in versions:
            print(f"  - {v.version}: accuracy={v.accuracy}, active={v.is_active}")

        # Get current active model
        active = crud.get_active_model(db, "layer_classifier")
        if active:
            print(f"✓ Current active: {active.version}")

        # Activate new model (deactivates old one)
        crud.set_active_model(db, new_model.id)
        print(f"✓ Activated model: {new_model.version}")

        # Verify activation
        active = crud.get_active_model(db, "layer_classifier")
        print(f"✓ Active model is now: {active.version}")

    finally:
        db.close()


# ============================================================================
# EXAMPLE 4: In a FastAPI endpoint
# ============================================================================

from fastapi import FastAPI, Depends
from sqlalchemy.orm import Session

app = FastAPI()


@app.post("/api/projects")
async def create_project_endpoint(
    name: str,
    address: str = None,
    db: Session = Depends(get_db)
):
    """Create a project"""
    try:
        project = crud.create_project(
            db,
            name=name,
            address=address
        )
        return {
            "success": True,
            "project_id": str(project.id),
            "name": project.name
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }


@app.get("/api/projects/{project_id}")
async def get_project_endpoint(
    project_id: str,
    db: Session = Depends(get_db)
):
    """Get project details"""
    try:
        project = crud.get_project(db, UUID(project_id))
        if not project:
            return {"error": "Project not found"}

        return {
            "id": str(project.id),
            "name": project.name,
            "address": project.address,
            "zone_type": project.zone_type,
            "created_at": project.created_at.isoformat()
        }
    except Exception as e:
        return {"error": str(e)}


@app.get("/api/projects/{project_id}/models")
async def get_project_models(
    project_id: str,
    db: Session = Depends(get_db)
):
    """Get all models for a project"""
    try:
        models = crud.get_generated_models_by_project(db, UUID(project_id))
        return [
            {
                "id": str(m.id),
                "type": m.model_type,
                "height": m.height,
                "floors": m.floors,
                "created_at": m.created_at.isoformat()
            }
            for m in models
        ]
    except Exception as e:
        return {"error": str(e)}


# ============================================================================
# EXAMPLE 5: Transaction handling
# ============================================================================

def transaction_example():
    """
    Using database transactions for consistency
    """
    db = SessionLocal()
    try:
        # All operations within this block are a transaction
        # If any operation fails, all changes are rolled back

        project = crud.create_project(db, name="Test Project")
        dxf = crud.create_dxf_file(
            db,
            project_id=project.id,
            original_filename="test.dxf",
            stored_path="/uploads/test.dxf",
            file_size=1024
        )
        model = crud.save_generated_model(
            db,
            project_id=project.id,
            dxf_file_id=dxf.id,
            model_type="mass",
            file_path="/models/test.glb",
            height=10.0,
            floors=3
        )

        # All changes committed together
        db.commit()
        print(f"✓ Transaction committed: {project.id}, {dxf.id}, {model.id}")

    except Exception as e:
        # Automatic rollback on error
        db.rollback()
        print(f"✗ Transaction rolled back: {e}")
    finally:
        db.close()


if __name__ == "__main__":
    print("\n" + "="*70)
    print("EXAMPLE 1: Complete Project Workflow")
    print("="*70)
    ids = create_project_workflow()
    print("\nGenerated IDs:")
    for key, value in ids.items():
        print(f"  {key}: {value}")

    print("\n" + "="*70)
    print("EXAMPLE 2: Query Project Details")
    print("="*70)
    project_details = query_project_details(ids["project_id"])
    print(f"\nProject details:")
    import json
    print(json.dumps(project_details, indent=2, default=str))

    print("\n" + "="*70)
    print("EXAMPLE 3: Manage AI Models")
    print("="*70)
    manage_ai_models()

    print("\n" + "="*70)
    print("EXAMPLE 5: Transaction Handling")
    print("="*70)
    transaction_example()

    print("\n✓ All examples completed successfully!\n")
