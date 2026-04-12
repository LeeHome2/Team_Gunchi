"""
Admin console API routes.

All endpoints live under /api/admin/* and are consumed by the Next.js
admin pages. These are intentionally DB-backed (not mocked) so the admin
console reflects real state.
"""

from __future__ import annotations

import asyncio
import os
import time
from datetime import datetime
from typing import Dict, List, Optional, Tuple
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database.config import get_db
from database import crud
from services import log_buffer


router = APIRouter(prefix="/api/admin", tags=["admin"])


# ---------------------------------------------------------------------------
# Tiny in-memory response cache for read-heavy admin endpoints.
#
# Admin pages often refetch on navigation; a 5s TTL makes repeated loads
# instant without showing stale data for meaningful periods.
# ---------------------------------------------------------------------------


class _TTLCache:
    def __init__(self) -> None:
        self._store: Dict[str, Tuple[float, object]] = {}

    def get(self, key: str, ttl: float):
        entry = self._store.get(key)
        if not entry:
            return None
        ts, value = entry
        if time.monotonic() - ts > ttl:
            return None
        return value

    def set(self, key: str, value: object) -> None:
        self._store[key] = (time.monotonic(), value)

    def invalidate(self, prefix: str = "") -> None:
        if not prefix:
            self._store.clear()
            return
        for k in list(self._store):
            if k.startswith(prefix):
                del self._store[k]


_cache = _TTLCache()


# ============================================================================
# Pydantic schemas
# ============================================================================


class UserOut(BaseModel):
    id: str
    name: str
    email: str
    status: str
    joined_at: Optional[str]
    last_login_at: Optional[str]
    project_count: int


class UserCreate(BaseModel):
    name: str
    email: str
    status: str = "pending"


class UserStatusUpdate(BaseModel):
    status: str  # "active" | "pending" | "suspended"


class AdminAccountOut(BaseModel):
    id: str
    email: str
    name: str
    role: str
    is_active: bool
    last_login_at: Optional[str]
    created_at: Optional[str]


class AdminAccountCreate(BaseModel):
    email: str
    name: str
    role: str = "viewer"


class AdminAccountUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None


class ApiKeyOut(BaseModel):
    id: str
    name: str
    prefix: str
    environment: str
    is_active: bool
    created_at: Optional[str]
    last_used_at: Optional[str]


class ApiKeyCreate(BaseModel):
    name: str
    environment: str = "live"


class BaseRuleOut(BaseModel):
    key: str
    label: str
    unit: str
    value: float
    description: Optional[str]
    updated_at: Optional[str]


class BaseRuleUpsert(BaseModel):
    key: str
    label: str
    unit: str
    value: float
    description: Optional[str] = None


class ZoneRuleOut(BaseModel):
    id: str
    zone: str
    region: str
    coverage: float
    far: float
    height_max: float
    setback: float
    updated_at: Optional[str]


class ZoneRuleCreate(BaseModel):
    zone: str
    region: str
    coverage: float
    far: float
    height_max: float
    setback: float


class ZoneRuleUpdate(BaseModel):
    zone: Optional[str] = None
    region: Optional[str] = None
    coverage: Optional[float] = None
    far: Optional[float] = None
    height_max: Optional[float] = None
    setback: Optional[float] = None


class ResultOut(BaseModel):
    id: str
    project_id: str
    project_name: str
    is_valid: bool
    coverage: Optional[float]
    floor_area_ratio: Optional[float]
    height: Optional[float]
    zone_type: Optional[str]
    created_at: Optional[str]


class AIModelOut(BaseModel):
    id: str
    model_name: str
    version: str
    model_type: str
    is_active: bool
    accuracy: Optional[float]
    description: Optional[str]
    trained_at: Optional[str]
    created_at: Optional[str]


class AIModelCreate(BaseModel):
    model_name: str
    version: str
    model_type: str
    accuracy: Optional[float] = None
    description: Optional[str] = None
    file_path: Optional[str] = None


class ServiceSettingUpsert(BaseModel):
    key: str
    value: str


# ============================================================================
# DASHBOARD
# ============================================================================


@router.get("/dashboard")
def dashboard(db: Session = Depends(get_db)):
    """Aggregate KPIs + recent events shown on the admin dashboard.

    Cached for 5 seconds so repeated page navigations are instant.
    """
    cached = _cache.get("dashboard", ttl=5.0)
    if cached is not None:
        return cached

    metrics = crud.dashboard_metrics(db)
    # Recent events come from the in-memory log buffer (cheap; don't cache)
    metrics["recent_events"] = log_buffer.get_logs(limit=10)
    _cache.set("dashboard", metrics)
    return metrics


# ============================================================================
# USERS
# ============================================================================


def _serialize_user(u) -> dict:
    return {
        "id": str(u.id),
        "name": u.name,
        "email": u.email,
        "status": u.status,
        "joined_at": u.joined_at.isoformat() if u.joined_at else None,
        "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None,
        "project_count": u.project_count,
    }


@router.get("/users")
def list_users(
    status: Optional[str] = None,
    query: Optional[str] = None,
    db: Session = Depends(get_db),
):
    cache_key = f"users:{status or ''}:{query or ''}"
    cached = _cache.get(cache_key, ttl=5.0)
    if cached is not None:
        return cached

    users = crud.list_users(db, status=status, query=query)
    counts = crud.count_users_by_status(db)
    payload = {
        "users": [_serialize_user(u) for u in users],
        "counts": counts,
    }
    _cache.set(cache_key, payload)
    return payload


@router.post("/users")
def create_user(payload: UserCreate, db: Session = Depends(get_db)):
    user = crud.create_user(db, name=payload.name, email=payload.email, status=payload.status)
    _cache.invalidate("users:")
    _cache.invalidate("dashboard")
    return _serialize_user(user)


@router.patch("/users/{user_id}/status")
def update_user_status(
    user_id: UUID, payload: UserStatusUpdate, db: Session = Depends(get_db)
):
    user = crud.update_user_status(db, user_id=user_id, status=payload.status)
    if not user:
        raise HTTPException(status_code=404, detail="user not found")
    _cache.invalidate("users:")
    return _serialize_user(user)


@router.delete("/users/{user_id}")
def delete_user(user_id: UUID, db: Session = Depends(get_db)):
    ok = crud.delete_user(db, user_id=user_id)
    if not ok:
        raise HTTPException(status_code=404, detail="user not found")
    _cache.invalidate("users:")
    _cache.invalidate("dashboard")
    return {"ok": True}


# ============================================================================
# PROJECTS (admin view)
# ============================================================================


@router.get("/projects")
def list_projects(db: Session = Depends(get_db)):
    """List all projects + DXF metadata in a single aggregated query (no N+1)."""
    cached = _cache.get("projects", ttl=5.0)
    if cached is not None:
        return cached

    from sqlalchemy import func as sa_func
    from database.models import Project, DxfFile

    # Single query: LEFT JOIN + aggregate so we get one row per project
    # with has_dxf and first area_sqm in one round-trip.
    rows_q = (
        db.query(
            Project,
            sa_func.count(DxfFile.id).label("dxf_count"),
            sa_func.max(DxfFile.area_sqm).label("area_sqm"),
        )
        .outerjoin(DxfFile, DxfFile.project_id == Project.id)
        .group_by(Project.id)
        .order_by(Project.created_at.desc())
        .limit(500)
        .all()
    )

    rows = [
        {
            "id": str(p.id),
            "name": p.name,
            "address": p.address,
            "zone_type": p.zone_type,
            "created_at": p.created_at.isoformat() if p.created_at else None,
            "updated_at": p.updated_at.isoformat() if p.updated_at else None,
            "has_dxf": int(dxf_count or 0) > 0,
            "area_sqm": area_sqm,
        }
        for p, dxf_count, area_sqm in rows_q
    ]
    result = {"projects": rows, "total": len(rows)}
    _cache.set("projects", result)
    return result


# ============================================================================
# RESULTS (validation)
# ============================================================================


@router.get("/results")
def list_results(db: Session = Depends(get_db)):
    cached = _cache.get("results", ttl=5.0)
    if cached is not None:
        return cached

    rows = crud.list_validation_results_extended(db, limit=300)
    total = len(rows)
    valid = sum(1 for r in rows if r["is_valid"])
    invalid = total - valid
    result = {
        "results": rows,
        "total": total,
        "valid": valid,
        "invalid": invalid,
        "pass_rate": (valid / total * 100) if total else 0.0,
    }
    _cache.set("results", result)
    return result


# ============================================================================
# REGULATIONS
# ============================================================================


def _serialize_base_rule(r) -> dict:
    return {
        "key": r.key,
        "label": r.label,
        "unit": r.unit,
        "value": r.value,
        "description": r.description,
        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
    }


def _serialize_zone_rule(r) -> dict:
    return {
        "id": str(r.id),
        "zone": r.zone,
        "region": r.region,
        "coverage": r.coverage,
        "far": r.far,
        "height_max": r.height_max,
        "setback": r.setback,
        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
    }


@router.get("/regulations/base")
def list_base_rules(db: Session = Depends(get_db)):
    cached = _cache.get("regulations:base", ttl=10.0)
    if cached is not None:
        return cached
    rules = crud.list_base_rules(db)
    payload = {"rules": [_serialize_base_rule(r) for r in rules]}
    _cache.set("regulations:base", payload)
    return payload


@router.put("/regulations/base")
def upsert_base_rule(payload: BaseRuleUpsert, db: Session = Depends(get_db)):
    rule = crud.upsert_base_rule(
        db,
        key=payload.key,
        label=payload.label,
        unit=payload.unit,
        value=payload.value,
        description=payload.description,
    )
    _cache.invalidate("regulations:base")
    return _serialize_base_rule(rule)


@router.get("/regulations/zones")
def list_zone_rules(db: Session = Depends(get_db)):
    cached = _cache.get("regulations:zones", ttl=10.0)
    if cached is not None:
        return cached
    rules = crud.list_zone_rules(db)
    payload = {"rules": [_serialize_zone_rule(r) for r in rules]}
    _cache.set("regulations:zones", payload)
    return payload


@router.post("/regulations/zones")
def create_zone_rule(payload: ZoneRuleCreate, db: Session = Depends(get_db)):
    rule = crud.create_zone_rule(
        db,
        zone=payload.zone,
        region=payload.region,
        coverage=payload.coverage,
        far=payload.far,
        height_max=payload.height_max,
        setback=payload.setback,
    )
    _cache.invalidate("regulations:zones")
    return _serialize_zone_rule(rule)


@router.patch("/regulations/zones/{rule_id}")
def update_zone_rule(
    rule_id: UUID, payload: ZoneRuleUpdate, db: Session = Depends(get_db)
):
    rule = crud.update_zone_rule(db, rule_id=rule_id, **payload.dict(exclude_unset=True))
    if not rule:
        raise HTTPException(status_code=404, detail="zone rule not found")
    _cache.invalidate("regulations:zones")
    return _serialize_zone_rule(rule)


@router.delete("/regulations/zones/{rule_id}")
def delete_zone_rule(rule_id: UUID, db: Session = Depends(get_db)):
    ok = crud.delete_zone_rule(db, rule_id=rule_id)
    if not ok:
        raise HTTPException(status_code=404, detail="zone rule not found")
    _cache.invalidate("regulations:zones")
    return {"ok": True}


# ============================================================================
# AI MODELS
# ============================================================================


def _serialize_ai_model(m) -> dict:
    return {
        "id": str(m.id),
        "model_name": m.model_name,
        "version": m.version,
        "model_type": m.model_type,
        "is_active": m.is_active,
        "accuracy": m.accuracy,
        "description": m.description,
        "file_path": m.file_path,
        "trained_at": m.trained_at.isoformat() if m.trained_at else None,
        "created_at": m.created_at.isoformat() if m.created_at else None,
    }


@router.get("/ai/models")
def list_ai_models(db: Session = Depends(get_db)):
    cached = _cache.get("ai:models", ttl=10.0)
    if cached is not None:
        return cached
    models = crud.list_all_model_versions(db)
    payload = {"models": [_serialize_ai_model(m) for m in models]}
    _cache.set("ai:models", payload)
    return payload


@router.post("/ai/models")
def create_ai_model(payload: AIModelCreate, db: Session = Depends(get_db)):
    model = crud.create_ai_model_version(
        db,
        model_name=payload.model_name,
        version=payload.version,
        model_type=payload.model_type,
        accuracy=payload.accuracy,
        description=payload.description,
        file_path=payload.file_path,
    )
    _cache.invalidate("ai:models")
    return _serialize_ai_model(model)


@router.post("/ai/models/{model_id}/activate")
def activate_ai_model(model_id: UUID, db: Session = Depends(get_db)):
    model = crud.set_active_model(db, model_id=model_id)
    if not model:
        raise HTTPException(status_code=404, detail="model not found")
    _cache.invalidate("ai:models")
    return _serialize_ai_model(model)


@router.post("/ai/models/{model_id}/deactivate")
def deactivate_ai_model(model_id: UUID, db: Session = Depends(get_db)):
    model = crud.deactivate_model(db, model_id=model_id)
    if not model:
        raise HTTPException(status_code=404, detail="model not found")
    _cache.invalidate("ai:models")
    return _serialize_ai_model(model)


# ============================================================================
# LOGS
# ============================================================================


@router.get("/logs")
def list_logs(
    level: Optional[str] = None,
    q: Optional[str] = None,
    limit: int = 200,
):
    return {
        "logs": log_buffer.get_logs(level=level, query=q, limit=limit),
        "counts": log_buffer.level_counts(),
    }


# ============================================================================
# ADMIN ACCOUNTS
# ============================================================================


def _serialize_admin(a) -> dict:
    return {
        "id": str(a.id),
        "email": a.email,
        "name": a.name,
        "role": a.role,
        "is_active": a.is_active,
        "last_login_at": a.last_login_at.isoformat() if a.last_login_at else None,
        "created_at": a.created_at.isoformat() if a.created_at else None,
    }


@router.get("/auth/accounts")
def list_admins(db: Session = Depends(get_db)):
    cached = _cache.get("auth:accounts", ttl=10.0)
    if cached is not None:
        return cached
    admins = crud.list_admin_accounts(db)
    payload = {"accounts": [_serialize_admin(a) for a in admins]}
    _cache.set("auth:accounts", payload)
    return payload


@router.post("/auth/accounts")
def create_admin(payload: AdminAccountCreate, db: Session = Depends(get_db)):
    a = crud.create_admin_account(
        db, email=payload.email, name=payload.name, role=payload.role
    )
    _cache.invalidate("auth:accounts")
    return _serialize_admin(a)


@router.patch("/auth/accounts/{admin_id}")
def update_admin(
    admin_id: UUID, payload: AdminAccountUpdate, db: Session = Depends(get_db)
):
    a = crud.update_admin_account(
        db,
        admin_id=admin_id,
        name=payload.name,
        role=payload.role,
        is_active=payload.is_active,
    )
    if not a:
        raise HTTPException(status_code=404, detail="admin not found")
    _cache.invalidate("auth:accounts")
    return _serialize_admin(a)


@router.delete("/auth/accounts/{admin_id}")
def delete_admin(admin_id: UUID, db: Session = Depends(get_db)):
    ok = crud.delete_admin_account(db, admin_id=admin_id)
    if not ok:
        raise HTTPException(status_code=404, detail="admin not found")
    _cache.invalidate("auth:accounts")
    return {"ok": True}


# ============================================================================
# API KEYS
# ============================================================================


def _serialize_api_key(k) -> dict:
    return {
        "id": str(k.id),
        "name": k.name,
        "prefix": k.prefix,
        "environment": k.environment,
        "is_active": k.is_active,
        "created_at": k.created_at.isoformat() if k.created_at else None,
        "last_used_at": k.last_used_at.isoformat() if k.last_used_at else None,
    }


@router.get("/auth/api-keys")
def list_keys(db: Session = Depends(get_db)):
    cached = _cache.get("auth:api-keys", ttl=10.0)
    if cached is not None:
        return cached
    keys = crud.list_api_keys(db)
    payload = {"keys": [_serialize_api_key(k) for k in keys]}
    _cache.set("auth:api-keys", payload)
    return payload


@router.post("/auth/api-keys")
def create_key(payload: ApiKeyCreate, db: Session = Depends(get_db)):
    import secrets

    # Generate a "prefix" like sk_live_xxxx (last 4 chars shown)
    raw = secrets.token_hex(16)
    prefix = f"sk_{payload.environment}_{raw[:4]}…"
    key = crud.create_api_key(
        db, name=payload.name, prefix=prefix, environment=payload.environment, key_hash=raw
    )
    out = _serialize_api_key(key)
    # Return the raw key only on creation (so caller can copy once)
    out["raw_key"] = f"sk_{payload.environment}_{raw}"
    _cache.invalidate("auth:api-keys")
    return out


@router.post("/auth/api-keys/{key_id}/revoke")
def revoke_key(key_id: UUID, db: Session = Depends(get_db)):
    key = crud.revoke_api_key(db, key_id=key_id)
    if not key:
        raise HTTPException(status_code=404, detail="api key not found")
    _cache.invalidate("auth:api-keys")
    return _serialize_api_key(key)


@router.delete("/auth/api-keys/{key_id}")
def delete_key(key_id: UUID, db: Session = Depends(get_db)):
    ok = crud.delete_api_key(db, key_id=key_id)
    if not ok:
        raise HTTPException(status_code=404, detail="api key not found")
    _cache.invalidate("auth:api-keys")
    return {"ok": True}


# ============================================================================
# SERVICE SETTINGS + ENDPOINT HEALTH
# ============================================================================

# Endpoints we probe for live status
_PROBE_ENDPOINTS = [
    {"name": "Core API", "url": "/health", "method": "GET"},
    {"name": "Projects", "url": "/api/projects", "method": "GET"},
    {"name": "Models directory", "url": "/models/", "method": "GET"},
    {"name": "AI Classify", "url": "/api/classify", "method": "OPTIONS"},
]


@router.get("/service/settings")
def get_service_settings(db: Session = Depends(get_db)):
    cached = _cache.get("service:settings", ttl=10.0)
    if cached is not None:
        return cached

    stored = crud.list_service_settings(db)
    # merge with env defaults
    defaults = {
        "api_url": os.getenv("API_URL", "http://localhost:8000"),
        "ai_url": os.getenv("AI_URL", ""),
        "rate_limit": "100",
        "timeout": "30",
        "log_level": os.getenv("LOG_LEVEL", "INFO"),
        "log_retention_days": "30",
        "error_mode": "notify",
        "maintenance": "false",
    }
    merged = {**defaults, **stored}
    payload = {"settings": merged}
    _cache.set("service:settings", payload)
    return payload


@router.put("/service/settings")
def put_service_setting(payload: ServiceSettingUpsert, db: Session = Depends(get_db)):
    setting = crud.upsert_service_setting(db, key=payload.key, value=payload.value)
    _cache.invalidate("service:settings")
    return {"key": setting.key, "value": setting.value}


# Small in-memory cache for endpoint health to keep /service/endpoints snappy
# even when probes time out. Values expire after _PROBE_TTL seconds.
_PROBE_TTL = 10.0
_probe_cache: Dict[str, Tuple[float, List[dict]]] = {}


async def _probe_one(client: httpx.AsyncClient, base: str, ep: dict) -> dict:
    url = f"{base}{ep['url']}"
    started = time.perf_counter()
    try:
        if ep["method"] == "OPTIONS":
            r = await client.options(url)
        else:
            r = await client.get(url)
        latency_ms = (time.perf_counter() - started) * 1000
        if r.status_code < 400:
            status = "ok"
        elif r.status_code < 500:
            status = "degraded"
        else:
            status = "down"
    except Exception:
        status = "down"
        latency_ms = None
    return {
        "name": ep["name"],
        "url": f"{ep['method']} {ep['url']}",
        "status": status,
        "latency_ms": round(latency_ms, 1) if latency_ms is not None else None,
    }


@router.get("/service/endpoints")
async def list_endpoints():
    """Probe each endpoint (async, parallel, cached) for live status + latency.

    - Probes run concurrently via asyncio.gather
    - Per-request timeout is 1.2s (was 3s × 4 sequential = up to 12s before)
    - Result is cached in memory for 10s so repeated page loads are instant
    """
    base = os.getenv("API_URL", "http://localhost:8000").rstrip("/")
    cache_key = base
    now = time.monotonic()
    cached = _probe_cache.get(cache_key)
    if cached and now - cached[0] < _PROBE_TTL:
        return {"endpoints": cached[1], "cached": True}

    timeout = httpx.Timeout(connect=0.8, read=1.2, write=1.2, pool=1.2)
    async with httpx.AsyncClient(timeout=timeout) as client:
        rows = await asyncio.gather(
            *[_probe_one(client, base, ep) for ep in _PROBE_ENDPOINTS]
        )

    rows_list = list(rows)
    _probe_cache[cache_key] = (now, rows_list)
    return {"endpoints": rows_list, "cached": False}
