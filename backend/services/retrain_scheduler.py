"""
AI 모델 재학습 자동 스케줄러.

신뢰도 기반 또는 주기별로 재학습을 트리거합니다.
- 신뢰도 기반: 최근 분류 결과의 평균 신뢰도가 임계값 미만이면 트리거
- 주기별: 설정된 주기(일)마다 자동 트리거
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta
from typing import Optional, Dict, Any
import httpx

logger = logging.getLogger(__name__)

# 체크 주기 (초) - 1시간마다 체크
CHECK_INTERVAL_SECONDS = 3600


class RetrainScheduler:
    """재학습 자동 스케줄러."""

    def __init__(self, db_session_factory, ai_server_url: str = "http://localhost:65006"):
        """
        Args:
            db_session_factory: DB 세션 팩토리 (get_db와 유사)
            ai_server_url: AI 서버 URL
        """
        self.db_session_factory = db_session_factory
        self.ai_server_url = ai_server_url
        self._running = False
        self._task: Optional[asyncio.Task] = None

    def start(self):
        """스케줄러 시작."""
        if self._running:
            logger.warning("RetrainScheduler already running")
            return
        self._running = True
        self._task = asyncio.create_task(self._run_loop())
        logger.info("RetrainScheduler started")

    def stop(self):
        """스케줄러 중지."""
        self._running = False
        if self._task:
            self._task.cancel()
            self._task = None
        logger.info("RetrainScheduler stopped")

    async def _run_loop(self):
        """메인 체크 루프."""
        while self._running:
            try:
                await self._check_and_trigger()
            except Exception as e:
                logger.error(f"RetrainScheduler check failed: {e}")

            # 다음 체크까지 대기
            await asyncio.sleep(CHECK_INTERVAL_SECONDS)

    async def _check_and_trigger(self):
        """재학습 조건 체크 및 트리거."""
        from database.crud import list_service_settings, upsert_service_setting

        db = self.db_session_factory()
        try:
            settings = list_service_settings(db)

            # AI 서버 URL 업데이트 (설정에서 가져오기)
            if settings.get("ai_url"):
                self.ai_server_url = settings["ai_url"]

            triggered = False
            trigger_reason = ""

            # 1. 주기별 재학습 체크
            if settings.get("periodic_retrain_enabled") == "true":
                triggered, trigger_reason = await self._check_periodic_retrain(settings, db)

            # 2. 신뢰도 기반 재학습 체크 (주기별에서 트리거 안 된 경우)
            if not triggered and settings.get("retrain_auto_enabled") == "true":
                triggered, trigger_reason = await self._check_confidence_retrain(settings, db)

            if triggered:
                logger.info(f"Retraining triggered: {trigger_reason}")
                await self._trigger_retrain(trigger_reason, db)

        finally:
            db.close()

    async def _check_periodic_retrain(self, settings: Dict[str, str], db) -> tuple[bool, str]:
        """주기별 재학습 조건 체크."""
        from database.crud import upsert_service_setting

        interval_days = int(settings.get("periodic_retrain_interval", "14"))
        last_run_str = settings.get("periodic_retrain_last_run", "")

        now = datetime.now()

        if not last_run_str:
            # 처음 실행 - 현재 시간을 last_run으로 설정하고 다음 주기부터 시작
            upsert_service_setting(db, "periodic_retrain_last_run", now.isoformat())
            db.commit()
            logger.info(f"Periodic retrain initialized. Next run in {interval_days} days.")
            return False, ""

        try:
            last_run = datetime.fromisoformat(last_run_str)
        except ValueError:
            last_run = now
            upsert_service_setting(db, "periodic_retrain_last_run", now.isoformat())
            db.commit()
            return False, ""

        # 주기가 지났는지 체크
        next_run = last_run + timedelta(days=interval_days)
        if now >= next_run:
            return True, f"periodic ({interval_days} days interval)"

        return False, ""

    async def _check_confidence_retrain(self, settings: Dict[str, str], db) -> tuple[bool, str]:
        """신뢰도 기반 재학습 조건 체크."""
        threshold = float(settings.get("retrain_confidence_threshold", "70")) / 100.0

        # 최근 분류 결과의 평균 신뢰도 조회
        avg_confidence = await self._get_recent_avg_confidence(db)

        if avg_confidence is not None and avg_confidence < threshold:
            return True, f"low confidence ({avg_confidence*100:.1f}% < {threshold*100:.0f}%)"

        return False, ""

    async def _get_recent_avg_confidence(self, db, days: int = 7) -> Optional[float]:
        """최근 N일간 분류 결과의 평균 신뢰도 조회."""
        from sqlalchemy import text
        from datetime import datetime, timedelta

        since = datetime.now() - timedelta(days=days)

        try:
            # dxf_classifications 테이블에서 평균 신뢰도 조회
            result = db.execute(
                text("""
                    SELECT AVG(average_confidence) as avg_conf
                    FROM dxf_classifications
                    WHERE classified_at >= :since
                """),
                {"since": since}
            )
            row = result.fetchone()
            if row and row[0] is not None:
                return float(row[0])
        except Exception as e:
            logger.warning(f"Failed to get avg confidence: {e}")

        return None

    async def _trigger_retrain(self, reason: str, db):
        """AI 서버에 재학습 요청."""
        from database.crud import upsert_service_setting

        try:
            # 최신 전처리 완료 데이터셋 조회
            processed_dataset = await self._get_latest_processed_dataset(db)

            if not processed_dataset:
                logger.warning("No processed dataset available for retraining")
                return

            # AI 서버에 학습 요청
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    f"{self.ai_server_url}/api/mlops/train",
                    json={
                        "input_dir": processed_dataset.get("path", "data/labeled"),
                        "train_ratio": 0.70,
                        "val_ratio": 0.15,
                        "model_type": "hist_gradient",
                    }
                )

                if response.status_code == 200:
                    result = response.json()
                    logger.info(f"Retrain triggered successfully: {result}")

                    # 마지막 실행 시간 업데이트
                    now = datetime.now().isoformat()
                    upsert_service_setting(db, "periodic_retrain_last_run", now)
                    upsert_service_setting(db, "last_auto_retrain", now)
                    upsert_service_setting(db, "last_auto_retrain_reason", reason)
                    db.commit()
                else:
                    logger.error(f"Retrain request failed: {response.status_code} - {response.text}")

        except Exception as e:
            logger.error(f"Failed to trigger retrain: {e}")

    async def _get_latest_processed_dataset(self, db=None) -> Optional[Dict[str, Any]]:
        """학습 input 으로 사용할 라벨링 CSV 디렉토리 결정.

        train.py 는 라벨링된 CSV 디렉토리만 학습 input 으로 받는다.
        선택 우선순위:
          1) service_settings.retrain_dataset_id 가 지정돼있고 그 데이터셋이
             processed_datasets 에 존재 → 그 csv_path 사용
          2) processed_datasets 중 'default' id (학과 서버의 메인 98 DXF 셋)
          3) processed_datasets 의 첫 항목
          4) meta.datasets 중 labeled_dir 가 있는 마지막 항목
          5) fallback "data/labeled"
        """
        # 사용자가 명시 선택한 데이터셋 id (DB)
        preferred_id: Optional[str] = None
        if db is not None:
            try:
                from database.crud import list_service_settings
                s = list_service_settings(db) or {}
                v = s.get("retrain_dataset_id")
                preferred_id = v if v else None
            except Exception as e:
                logger.warning(f"retrain_dataset_id read failed: {e}")

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(f"{self.ai_server_url}/api/mlops/datasets")
                if response.status_code != 200:
                    return None
                data = response.json()

                processed = data.get("processed_datasets", []) or []

                def _pack(item: Dict[str, Any]) -> Dict[str, Any]:
                    return {
                        "path": item.get("csv_path") or "data/labeled",
                        "id": item.get("id"),
                        "name": item.get("name"),
                        "count": item.get("labeled_count"),
                    }

                # 1) 사용자 명시 선택
                if preferred_id:
                    for p in processed:
                        if p.get("id") == preferred_id:
                            return _pack(p)
                    logger.warning(
                        f"retrain_dataset_id={preferred_id} 가 processed_datasets 에 없어 default 로 폴백"
                    )

                # 2) 'default' id 우선 (학과 서버 메인 98 DXF 라벨링 셋)
                for p in processed:
                    if p.get("id") == "default":
                        return _pack(p)

                # 3) processed_datasets 첫 항목
                if processed:
                    return _pack(processed[0])

                # 4) meta.datasets 의 labeled_dir
                for ds in reversed(data.get("meta", {}).get("datasets", []) or []):
                    auto = ds.get("auto_csv") or {}
                    labeled_dir = ds.get("labeled_dir") or auto.get("labeled_dir")
                    if labeled_dir and (auto.get("labeled_count", 0) > 0 or auto.get("success")):
                        return {
                            "path": labeled_dir,
                            "id": ds.get("id"),
                            "name": ds.get("name"),
                        }

                # 5) fallback
                return {"path": "data/labeled"}

        except Exception as e:
            logger.warning(f"Failed to get processed dataset: {e}")

        return None

    async def manual_trigger(self, reason: str = "manual") -> Dict[str, Any]:
        """수동 재학습 트리거 (API에서 호출용)."""
        from database.crud import list_service_settings

        db = self.db_session_factory()
        try:
            settings = list_service_settings(db)
            if settings.get("ai_url"):
                self.ai_server_url = settings["ai_url"]

            await self._trigger_retrain(reason, db)
            return {"success": True, "message": f"Retrain triggered: {reason}"}
        except Exception as e:
            return {"success": False, "error": str(e)}
        finally:
            db.close()


# 전역 스케줄러 인스턴스
_scheduler: Optional[RetrainScheduler] = None


def get_retrain_scheduler() -> Optional[RetrainScheduler]:
    """전역 스케줄러 인스턴스 반환."""
    return _scheduler


def init_retrain_scheduler(db_session_factory, ai_server_url: str = "http://localhost:65006"):
    """스케줄러 초기화 및 시작."""
    global _scheduler
    if _scheduler is None:
        _scheduler = RetrainScheduler(db_session_factory, ai_server_url)
        _scheduler.start()
    return _scheduler


def shutdown_retrain_scheduler():
    """스케줄러 종료."""
    global _scheduler
    if _scheduler:
        _scheduler.stop()
        _scheduler = None
