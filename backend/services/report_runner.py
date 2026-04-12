"""
결과 보고서(.docx) 생성 러너

backend/services/report_generator.js (Node) 를 subprocess 로 호출해서
Pydantic payload -> JSON -> docx 를 만든다.

Node 가 없거나 실행에 실패하면 RuntimeError 를 던져서 API 레이어가
HTTPException(500) 으로 변환하도록 한다.
"""

from __future__ import annotations

import datetime as _dt
import json
import logging
import os
import shutil
import subprocess
import tempfile
import uuid
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Resolve paths relative to this file so the runner works from any CWD.
_SERVICES_DIR = Path(__file__).resolve().parent
_GENERATOR_JS = _SERVICES_DIR / "report_generator.js"
_REPORTS_DIR = _SERVICES_DIR.parent / "reports"
_REPORTS_DIR.mkdir(exist_ok=True)

# Optional: allow a project-local node_modules directory to serve docx
_LOCAL_NODE_MODULES = _SERVICES_DIR.parent / "node_modules"


class ReportGenerationError(RuntimeError):
    """Raised when the Node generator fails for any reason."""


def _resolve_node_binary() -> str:
    override = os.getenv("NODE_BIN")
    if override:
        return override
    node = shutil.which("node")
    if not node:
        raise ReportGenerationError(
            "Node.js 를 찾을 수 없습니다. NODE_BIN 환경변수로 경로를 지정하거나 "
            "node 를 PATH 에 추가하세요."
        )
    return node


def _fill_defaults(payload: dict[str, Any]) -> dict[str, Any]:
    """meta.generated_at 이 비어있으면 오늘 날짜를 주입."""
    data = dict(payload or {})
    meta = dict(data.get("meta") or {})
    if not meta.get("generated_at"):
        meta["generated_at"] = _dt.date.today().isoformat()
    data["meta"] = meta
    return data


def generate_report_docx(payload: dict[str, Any]) -> Path:
    """
    payload -> .docx 파일 경로.
    파일은 backend/reports/<uuid>.docx 로 저장되며 호출 측이 삭제 책임을 갖는다.
    """
    if not _GENERATOR_JS.exists():
        raise ReportGenerationError(
            f"report_generator.js 를 찾을 수 없습니다: {_GENERATOR_JS}"
        )

    node = _resolve_node_binary()
    filled = _fill_defaults(payload)

    report_id = uuid.uuid4().hex
    out_path = _REPORTS_DIR / f"{report_id}.docx"

    with tempfile.NamedTemporaryFile(
        "w", suffix=".json", delete=False, encoding="utf-8"
    ) as tmp:
        json.dump(filled, tmp, ensure_ascii=False)
        tmp_path = Path(tmp.name)

    env = os.environ.copy()
    # Prefer repo-local node_modules if present so the docx library is found.
    if _LOCAL_NODE_MODULES.exists():
        existing = env.get("NODE_PATH", "")
        env["NODE_PATH"] = (
            f"{_LOCAL_NODE_MODULES}{os.pathsep}{existing}" if existing else str(_LOCAL_NODE_MODULES)
        )

    try:
        result = subprocess.run(
            [node, str(_GENERATOR_JS), str(tmp_path), str(out_path)],
            capture_output=True,
            text=True,
            timeout=60,
            env=env,
        )
    except subprocess.TimeoutExpired as exc:
        raise ReportGenerationError("보고서 생성 시간이 초과되었습니다.") from exc
    finally:
        try:
            tmp_path.unlink(missing_ok=True)
        except OSError:
            pass

    if result.returncode != 0:
        logger.error(
            "report_generator.js failed rc=%s stdout=%s stderr=%s",
            result.returncode,
            result.stdout,
            result.stderr,
        )
        raise ReportGenerationError(
            f"보고서 생성에 실패했습니다: {result.stderr.strip() or 'unknown error'}"
        )

    if not out_path.exists():
        raise ReportGenerationError("보고서 파일이 생성되지 않았습니다.")

    logger.info("report generated: %s (%d bytes)", out_path, out_path.stat().st_size)
    return out_path
