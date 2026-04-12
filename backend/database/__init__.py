"""
Database package initialization
Exports key items for easy importing
"""

from .config import Base, SessionLocal, engine, get_db, init_db, drop_all_tables

from .models import (
    Project,
    DxfFile,
    ClassificationResult,
    GeneratedModel,
    ValidationResult,
    SunlightAnalysis,
    PlacementOptimization,
    AIModelVersion,
)

from . import crud

__all__ = [
    # Config
    "Base",
    "SessionLocal",
    "engine",
    "get_db",
    "init_db",
    "drop_all_tables",
    # Models
    "Project",
    "DxfFile",
    "ClassificationResult",
    "GeneratedModel",
    "ValidationResult",
    "SunlightAnalysis",
    "PlacementOptimization",
    "AIModelVersion",
    # CRUD module
    "crud",
]
