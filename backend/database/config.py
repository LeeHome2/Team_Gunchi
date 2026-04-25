"""
Database configuration and session management.

Supports both PostgreSQL (production) and SQLite (local development).
- If DATABASE_URL env var is set → use it (PostgreSQL or any SQLAlchemy-compatible URL)
- Otherwise → fallback to local SQLite file at backend/data/building.db

Runtime switching between RDS and SQLite is supported via switch_database().
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

# 원본 RDS URL 보존 (런타임 전환용)
_RDS_URL = os.getenv("DATABASE_URL", "")
_SQLITE_URL = f"sqlite:///{_SQLITE_PATH}"

DATABASE_URL = _RDS_URL if _RDS_URL else _SQLITE_URL

if not _RDS_URL:
    logger.info(f"No DATABASE_URL set — using local SQLite: {_SQLITE_PATH}")


# ── Engine creation helper ───────────────────────────────────────────

def _create_engine_for(url: str):
    """Create a SQLAlchemy engine appropriate for the given URL."""
    is_sqlite = url.startswith("sqlite")
    sql_echo = os.getenv("SQL_ECHO", "false").lower() == "true"

    if is_sqlite:
        eng = create_engine(
            url,
            echo=sql_echo,
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )

        @event.listens_for(eng, "connect")
        def _set_sqlite_pragma(dbapi_conn, connection_record):
            cursor = dbapi_conn.cursor()
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()
    else:
        eng = create_engine(
            url,
            echo=sql_echo,
            pool_pre_ping=True,
            poolclass=NullPool if os.getenv("DATABASE_POOL") == "null" else None,
        )

    return eng


# ── Initial engine ───────────────────────────────────────────────────
_is_sqlite = DATABASE_URL.startswith("sqlite")

engine = _create_engine_for(DATABASE_URL)

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


# ── Runtime DB switch ────────────────────────────────────────────────

def get_db_type() -> str:
    """현재 사용 중인 DB 타입 반환: 'rds' | 'sqlite'"""
    return "sqlite" if _is_sqlite else "rds"


def get_db_info() -> dict:
    """현재 DB 연결 상태 정보"""
    masked_url = DATABASE_URL
    if "@" in masked_url:
        # 비밀번호 마스킹: postgresql://user:pass@host → postgresql://user:****@host
        prefix, suffix = masked_url.split("@", 1)
        if ":" in prefix.split("//")[-1]:
            scheme_user = prefix.rsplit(":", 1)[0]
            masked_url = f"{scheme_user}:****@{suffix}"
    return {
        "type": get_db_type(),
        "url": masked_url,
        "rds_available": bool(_RDS_URL),
    }


def switch_database(target: str) -> dict:
    """
    런타임 DB 전환.
    target: 'rds' | 'sqlite'
    Returns: 전환 후 DB 정보
    """
    global engine, SessionLocal, DATABASE_URL, _is_sqlite

    if target == "rds":
        if not _RDS_URL:
            raise ValueError("DATABASE_URL 환경변수가 설정되지 않아 RDS로 전환할 수 없습니다.")
        new_url = _RDS_URL
    elif target == "sqlite":
        new_url = _SQLITE_URL
    else:
        raise ValueError(f"지원하지 않는 DB 타입: {target} (rds 또는 sqlite만 가능)")

    if new_url == DATABASE_URL:
        logger.info(f"이미 {target} DB를 사용 중입니다.")
        return get_db_info()

    # 기존 엔진 정리
    try:
        engine.dispose()
    except Exception:
        pass

    # 새 엔진 생성
    DATABASE_URL = new_url
    _is_sqlite = new_url.startswith("sqlite")
    engine = _create_engine_for(new_url)
    SessionLocal.configure(bind=engine)

    # 테이블 생성 (SQLite 전환 시 필요)
    try:
        Base.metadata.create_all(bind=engine)
    except Exception as e:
        logger.error(f"테이블 생성 실패: {e}")

    logger.info(f"DB 전환 완료: {target} — {new_url.split('@')[-1] if '@' in new_url else new_url}")
    return get_db_info()


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
