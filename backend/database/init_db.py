"""
Database initialization script.

Creates all tables and seeds default rows needed by the admin console
(default users, admin accounts, base/zone regulation rules, AI model
versions). Safe to run repeatedly — seeding is idempotent.
"""

import logging
import sys
from pathlib import Path

# Add parent directory to path so we can import our modules
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy.orm import Session

from database.config import engine, Base, init_db, SessionLocal
from database import models  # Import all models to register them
from database import crud


logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Seed payloads
# ---------------------------------------------------------------------------

_SEED_USERS = [
    {"name": "김가천", "email": "kim.gacheon@example.com", "status": "active"},
    {"name": "이호민", "email": "homindol@gmail.com", "status": "active"},
    {"name": "박서연", "email": "park.seoyeon@example.com", "status": "active"},
    {"name": "최지훈", "email": "choi.jihoon@example.com", "status": "pending"},
    {"name": "정민아", "email": "jung.mina@example.com", "status": "active"},
    {"name": "강도윤", "email": "kang.doyoon@example.com", "status": "suspended"},
    {"name": "한소영", "email": "han.soyoung@example.com", "status": "active"},
]

_SEED_ADMINS = [
    {"email": "root@geonchi.ai", "name": "Root Admin", "role": "superadmin"},
    {"email": "ops@geonchi.ai", "name": "Ops User", "role": "ops"},
    {"email": "viewer@geonchi.ai", "name": "Viewer User", "role": "viewer"},
]

_SEED_BASE_RULES = [
    {
        "key": "coverage",
        "label": "건폐율",
        "unit": "%",
        "value": 60.0,
        "description": "대지면적 대비 건축면적의 최대 비율",
    },
    {
        "key": "far",
        "label": "용적률",
        "unit": "%",
        "value": 200.0,
        "description": "대지면적 대비 연면적의 최대 비율",
    },
    {
        "key": "setback",
        "label": "이격거리",
        "unit": "m",
        "value": 1.5,
        "description": "대지경계선에서 건축물까지의 최소 이격거리",
    },
    {
        "key": "height_max",
        "label": "최고높이",
        "unit": "m",
        "value": 12.0,
        "description": "건축물의 최고 높이 제한",
    },
    {
        "key": "sunlight",
        "label": "일조권 사선제한",
        "unit": "m",
        "value": 9.0,
        "description": "정북방향 일조권 사선 적용 시작 높이",
    },
]

_SEED_ZONE_RULES = [
    {
        "zone": "제1종 일반주거지역",
        "region": "서울특별시 전역",
        "coverage": 60.0,
        "far": 150.0,
        "height_max": 12.0,
        "setback": 1.5,
        "setback_road": 1.0,       # 도로변(건축선) 이격
        "setback_adjacent": 0.5,   # 인접대지 이격
    },
    {
        "zone": "제2종 일반주거지역",
        "region": "서울특별시 전역",
        "coverage": 60.0,
        "far": 200.0,
        "height_max": 15.0,
        "setback": 1.5,
        "setback_road": 1.0,
        "setback_adjacent": 0.5,
    },
    {
        "zone": "제3종 일반주거지역",
        "region": "서울특별시 전역",
        "coverage": 50.0,
        "far": 250.0,
        "height_max": 20.0,
        "setback": 2.0,
        "setback_road": 1.0,
        "setback_adjacent": 0.5,
    },
    {
        "zone": "일반상업지역",
        "region": "서울특별시 전역",
        "coverage": 80.0,
        "far": 800.0,
        "height_max": 40.0,
        "setback": 1.0,
        "setback_road": 0.0,       # 상업지역: 도로변 0m
        "setback_adjacent": 0.0,   # 상업지역: 인접대지 0m
    },
    {
        "zone": "근린상업지역",
        "region": "경기도 성남시",
        "coverage": 70.0,
        "far": 500.0,
        "height_max": 30.0,
        "setback": 1.0,
        "setback_road": 0.0,
        "setback_adjacent": 0.0,
    },
    {
        "zone": "준주거지역",
        "region": "인천광역시 연수구",
        "coverage": 70.0,
        "far": 400.0,
        "height_max": 25.0,
        "setback": 1.5,
        "setback_road": 1.0,
        "setback_adjacent": 0.5,
    },
]

_SEED_MODELS = [
    {
        "model_name": "layer_classifier",
        "version": "v2.1.0",
        "model_type": "random_forest",
        "accuracy": 0.923,
        "description": "RandomForest 기반 DXF 레이어 분류 모델 (prod)",
        "is_active": True,
    },
    {
        "model_name": "layer_classifier",
        "version": "v2.0.0",
        "model_type": "rule_based",
        "accuracy": 0.812,
        "description": "레거시 규칙 기반 분류기",
        "is_active": False,
    },
    {
        "model_name": "placement_optimizer",
        "version": "v1.3.0",
        "model_type": "genetic_algorithm",
        "accuracy": 0.881,
        "description": "GA 기반 건축 배치 최적화",
        "is_active": True,
    },
]


# ---------------------------------------------------------------------------
# Seeder
# ---------------------------------------------------------------------------


def seed_defaults(db: Session) -> None:
    """Populate default rows used by the admin console. Idempotent."""

    # Users
    existing_user_emails = {u.email for u in crud.list_users(db)}
    for payload in _SEED_USERS:
        if payload["email"] not in existing_user_emails:
            crud.create_user(
                db,
                name=payload["name"],
                email=payload["email"],
                status=payload["status"],
            )
            logger.info(f"Seeded user: {payload['email']}")

    # Admin accounts
    existing_admin_emails = {a.email for a in crud.list_admin_accounts(db)}
    for payload in _SEED_ADMINS:
        if payload["email"] not in existing_admin_emails:
            crud.create_admin_account(
                db, email=payload["email"], name=payload["name"], role=payload["role"]
            )
            logger.info(f"Seeded admin: {payload['email']}")

    # Base regulation rules
    for payload in _SEED_BASE_RULES:
        existing = crud.get_base_rule(db, key=payload["key"])
        if not existing:
            crud.upsert_base_rule(
                db,
                key=payload["key"],
                label=payload["label"],
                unit=payload["unit"],
                value=payload["value"],
                description=payload["description"],
            )
            logger.info(f"Seeded base rule: {payload['key']}")

    # Zone regulation rules
    existing_zones = {(r.zone, r.region) for r in crud.list_zone_rules(db)}
    for payload in _SEED_ZONE_RULES:
        key = (payload["zone"], payload["region"])
        if key not in existing_zones:
            crud.create_zone_rule(
                db,
                zone=payload["zone"],
                region=payload["region"],
                coverage=payload["coverage"],
                far=payload["far"],
                height_max=payload["height_max"],
                setback=payload["setback"],
                setback_road=payload.get("setback_road", 1.0),
                setback_adjacent=payload.get("setback_adjacent", 0.5),
            )
            logger.info(f"Seeded zone rule: {payload['zone']} / {payload['region']}")

    # AI model versions
    existing_models = {(m.model_name, m.version) for m in crud.list_all_model_versions(db)}
    for payload in _SEED_MODELS:
        key = (payload["model_name"], payload["version"])
        if key not in existing_models:
            model = crud.create_ai_model_version(
                db,
                model_name=payload["model_name"],
                version=payload["version"],
                model_type=payload["model_type"],
                accuracy=payload["accuracy"],
                description=payload["description"],
            )
            if payload.get("is_active"):
                crud.set_active_model(db, model_id=model.id)
            logger.info(f"Seeded AI model: {payload['model_name']} {payload['version']}")

    db.commit()


def seed_if_enabled() -> None:
    """Run seed_defaults inside its own session, swallowing errors.

    Called from FastAPI startup so fresh deploys get useful default rows.
    """
    db = SessionLocal()
    try:
        seed_defaults(db)
        logger.info("Seed defaults completed")
    except Exception as e:
        logger.error(f"Seed defaults failed: {e}", exc_info=True)
        db.rollback()
    finally:
        db.close()


def main():
    """Create all database tables and seed defaults."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    )

    try:
        logger.info("Creating database tables...")
        init_db()
        logger.info("Database tables created successfully!")
        logger.info("Seeding default rows...")
        seed_if_enabled()
        logger.info("Done.")
        return 0
    except Exception as e:
        logger.error(f"Failed to initialize database: {str(e)}", exc_info=True)
        return 1


if __name__ == "__main__":
    exit(main())
