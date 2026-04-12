"""
Database configuration and session management.

Supports both PostgreSQL (production) and SQLite (local development).
- If DATABASE_URL env var is set → use it (PostgreSQL or any SQLAlchemy-compatible URL)
- Otherwise → fallback to local SQLite file at backend/data/building.db
"""

from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from sqlalchemy.pool import NullPool, StaticPool
from pathlib import Path
import os
from typing import Generator
import logging

logger = logging.getLogger(__name__)

# ── Database URL resolution ──────────────────────────────────────────
_BACKEND_DIR = Path(__file__).resolve().parent.parent
_DATA_DIR = _BACKEND_DIR / "data"
_DATA_DIR.mkdir(exist_ok=True)
_SQLITE_PATH = _DATA_DIR / "building.db"

DATABASE_URL = os.getenv("DATABASE_URL", "")

if not DATABASE_URL:
    # No env var → local SQLite
    DATABASE_URL = f"sqlite:///{_SQLITE_PATH}"
    logger.info(f"No DATABASE_URL set — using local SQLite: {_SQLITE_PATH}")


# ── Engine creation ──────────────────────────────────────────────────
_is_sqlite = DATABASE_URL.startswith("sqlite")

if _is_sqlite:
    engine = create_engine(
        DATABASE_URL,
        echo=os.getenv("SQL_ECHO", "false").lower() == "true",
        connect_args={"check_same_thread": False},  # SQLite needs this for FastAPI
        poolclass=StaticPool,  # single connection for SQLite
    )

    # Enable WAL mode and foreign keys for SQLite
    @event.listens_for(engine, "connect")
    def _set_sqlite_pragma(dbapi_conn, connection_record):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()
else:
    engine = create_engine(
        DATABASE_URL,
        echo=os.getenv("SQL_ECHO", "false").lower() == "true",
        pool_pre_ping=True,
        poolclass=NullPool if os.getenv("DATABASE_POOL") == "null" else None,
    )

logger.info(f"Database engine: {'SQLite' if _is_sqlite else 'PostgreSQL'} — {DATABASE_URL.split('@')[-1] if '@' in DATABASE_URL else DATABASE_URL}")


SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
)


class Base(DeclarativeBase):
    """Base class for all ORM models"""
    pass


def get_db() -> Generator:
    """
    Dependency for getting database session in FastAPI endpoints.
    Usage: async def endpoint(db: Session = Depends(get_db)):
    """
    db = SessionLocal()
    try:
        yield db
    except Exception as e:
        logger.error(f"Database error: {str(e)}")
        db.rollback()
        raise
    finally:
        db.close()


def init_db():
    """Initialize database — create all tables if they don't exist"""
    try:
        Base.metadata.create_all(bind=engine)
        logger.info("Database tables created/verified successfully")
    except Exception as e:
        logger.error(f"Failed to create database tables: {str(e)}")
        # Don't raise — allow app to start even if DB init fails
        # (endpoints will fail individually)


def drop_all_tables():
    """Drop all tables (use with caution)"""
    try:
        Base.metadata.drop_all(bind=engine)
        logger.info("All database tables dropped")
    except Exception as e:
        logger.error(f"Failed to drop tables: {str(e)}")
        raise
