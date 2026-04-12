"""
In-memory ring buffer + logging handler used by the admin /logs endpoint.

The Python logging module is wired so every log record emitted by the
application also gets pushed into a bounded deque. The admin console polls
/api/admin/logs which returns the buffer contents as JSON.
"""

from __future__ import annotations

import logging
from collections import deque
from datetime import datetime
from threading import Lock
from typing import Deque, Dict, List, Optional


# Max number of records to keep in memory
_BUFFER_SIZE = 1000

# Circular buffer and lock
_buffer: Deque[Dict] = deque(maxlen=_BUFFER_SIZE)
_lock = Lock()
_id_counter = 0


class RingBufferHandler(logging.Handler):
    """logging.Handler that appends every formatted record into _buffer."""

    def emit(self, record: logging.LogRecord) -> None:
        global _id_counter
        try:
            msg = record.getMessage()
        except Exception:
            msg = record.msg
        ts = datetime.utcfromtimestamp(record.created).isoformat(sep=" ", timespec="seconds")
        level_name = record.levelname.lower()
        # Map unusual levels to a known set
        if level_name == "warning":
            level = "warn"
        elif level_name in ("error", "critical"):
            level = "error"
        elif level_name in ("info",):
            level = "info"
        else:
            level = "info"

        source = record.name
        with _lock:
            _id_counter += 1
            _buffer.append(
                {
                    "id": _id_counter,
                    "ts": ts,
                    "level": level,
                    "source": source,
                    "message": msg,
                }
            )


def install() -> None:
    """Install the handler on the root logger. Idempotent."""
    root = logging.getLogger()
    for h in root.handlers:
        if isinstance(h, RingBufferHandler):
            return
    handler = RingBufferHandler()
    handler.setLevel(logging.INFO)
    root.addHandler(handler)


def get_logs(
    level: Optional[str] = None,
    query: Optional[str] = None,
    limit: int = 200,
) -> List[Dict]:
    """Return buffered logs, newest first, optionally filtered."""
    with _lock:
        rows = list(_buffer)

    if level and level != "all":
        rows = [r for r in rows if r["level"] == level]
    if query:
        q = query.lower()
        rows = [
            r
            for r in rows
            if q in r["message"].lower() or q in r["source"].lower()
        ]

    rows.reverse()
    return rows[:limit]


def level_counts() -> Dict[str, int]:
    with _lock:
        rows = list(_buffer)
    counts = {"total": len(rows), "info": 0, "warn": 0, "error": 0}
    for r in rows:
        lvl = r["level"]
        if lvl in counts:
            counts[lvl] += 1
    return counts
