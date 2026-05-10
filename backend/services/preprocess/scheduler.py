"""
전처리 자동화 스케줄러.

미처리 건물을 자동으로 처리.
- cron 또는 FastAPI BackgroundTasks 로 트리거
- 처리 안 된 건물 (manifest.json 없는 폴더) 만 골라서 처리
"""
from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import List, Optional

from .clusterer import cluster_buildings
from .manifest import load_manifest
from .pipeline import preprocess_building

logger = logging.getLogger(__name__)


# 기본 경로
BASE_DIR = Path(__file__).parent.parent.parent  # backend/
DATA_DIR = BASE_DIR / "data"
RAW_DIR = DATA_DIR / "raw"
PROCESSED_DIR = DATA_DIR / "processed"

# AI 서버 URL
AI_SERVER_URL = "http://localhost:8001"


async def run_preprocess_for_unprocessed(
    raw_dir: Optional[Path] = None,
    processed_dir: Optional[Path] = None,
    ai_server_url: str = AI_SERVER_URL,
    mock: bool = False,
    limit: Optional[int] = None,
) -> dict:
    """raw_dir 의 모든 건물 폴더 검사 → manifest 없는 건물 처리.

    Args:
        raw_dir: 원본 DXF 디렉토리 (기본: data/raw)
        processed_dir: 처리 결과 디렉토리 (기본: data/processed)
        ai_server_url: 학과 AI 서버 URL
        mock: vLLM mock 모드
        limit: 처리 개수 제한

    Returns:
        {
            "total": int,
            "processed": int,
            "skipped": int,
            "failed": int,
            "results": [{"building_id": str, "status": str, "error": str|None}, ...]
        }
    """
    raw_dir = raw_dir or RAW_DIR
    processed_dir = processed_dir or PROCESSED_DIR

    # manual + auto 디렉토리 클러스터링
    groups = {}

    manual_dir = raw_dir / "manual"
    if manual_dir.exists():
        groups.update(cluster_buildings(manual_dir))

    auto_dir = raw_dir / "auto"
    if auto_dir.exists():
        for date_folder in auto_dir.iterdir():
            if date_folder.is_dir():
                sub_groups = cluster_buildings(date_folder)
                for bid, paths in sub_groups.items():
                    full_bid = f"auto_{date_folder.name}_{bid}"
                    groups[full_bid] = paths

    # 직속 DXF 파일도 처리
    direct_groups = cluster_buildings(raw_dir)
    groups.update(direct_groups)

    results = []
    processed_count = 0
    skipped_count = 0
    failed_count = 0

    items = list(groups.items())
    if limit:
        items = items[:limit]

    for building_id, files in items:
        manifest_path = processed_dir / building_id / "manifest.json"

        if manifest_path.exists():
            logger.info(f"이미 처리됨: {building_id}")
            results.append({"building_id": building_id, "status": "skipped", "error": None})
            skipped_count += 1
            continue

        try:
            logger.info(f"처리 시작: {building_id} ({len(files)} 파일)")
            await preprocess_building(
                building_id,
                files,
                ai_server_url=ai_server_url,
                mock=mock,
            )
            results.append({"building_id": building_id, "status": "completed", "error": None})
            processed_count += 1
            logger.info(f"처리 완료: {building_id}")

        except Exception as e:
            logger.error(f"처리 실패: {building_id} - {e}")
            results.append({"building_id": building_id, "status": "failed", "error": str(e)})
            failed_count += 1
            continue

    return {
        "total": len(items),
        "processed": processed_count,
        "skipped": skipped_count,
        "failed": failed_count,
        "results": results,
    }


def run_preprocess_sync(
    raw_dir: Optional[Path] = None,
    processed_dir: Optional[Path] = None,
    ai_server_url: str = AI_SERVER_URL,
    mock: bool = False,
    limit: Optional[int] = None,
) -> dict:
    """동기 버전 (asyncio.run 래퍼)."""
    return asyncio.run(run_preprocess_for_unprocessed(
        raw_dir=raw_dir,
        processed_dir=processed_dir,
        ai_server_url=ai_server_url,
        mock=mock,
        limit=limit,
    ))


def list_unprocessed_buildings(
    raw_dir: Optional[Path] = None,
    processed_dir: Optional[Path] = None,
) -> List[str]:
    """처리되지 않은 건물 ID 목록."""
    raw_dir = raw_dir or RAW_DIR
    processed_dir = processed_dir or PROCESSED_DIR

    groups = {}

    manual_dir = raw_dir / "manual"
    if manual_dir.exists():
        groups.update(cluster_buildings(manual_dir))

    auto_dir = raw_dir / "auto"
    if auto_dir.exists():
        for date_folder in auto_dir.iterdir():
            if date_folder.is_dir():
                sub_groups = cluster_buildings(date_folder)
                for bid, paths in sub_groups.items():
                    groups[f"auto_{date_folder.name}_{bid}"] = paths

    direct_groups = cluster_buildings(raw_dir)
    groups.update(direct_groups)

    unprocessed = []
    for building_id in groups:
        manifest_path = processed_dir / building_id / "manifest.json"
        if not manifest_path.exists():
            unprocessed.append(building_id)

    return unprocessed


def list_all_buildings(
    raw_dir: Optional[Path] = None,
    processed_dir: Optional[Path] = None,
) -> List[dict]:
    """모든 건물 상태 목록."""
    raw_dir = raw_dir or RAW_DIR
    processed_dir = processed_dir or PROCESSED_DIR

    groups = {}

    manual_dir = raw_dir / "manual"
    if manual_dir.exists():
        groups.update(cluster_buildings(manual_dir))

    auto_dir = raw_dir / "auto"
    if auto_dir.exists():
        for date_folder in auto_dir.iterdir():
            if date_folder.is_dir():
                sub_groups = cluster_buildings(date_folder)
                for bid, paths in sub_groups.items():
                    groups[f"auto_{date_folder.name}_{bid}"] = paths

    direct_groups = cluster_buildings(raw_dir)
    groups.update(direct_groups)

    result = []
    for building_id, files in groups.items():
        manifest_path = processed_dir / building_id / "manifest.json"
        manifest = load_manifest(manifest_path)

        result.append({
            "building_id": building_id,
            "file_count": len(files),
            "files": [f.name for f in files],
            "processed": manifest is not None,
            "floor_count": len(manifest.floors) if manifest else 0,
        })

    return result


# ─── CLI 진입점 ─────────────────────────────────────
def main():
    """CLI 진입점: python -m services.preprocess.scheduler"""
    import argparse

    parser = argparse.ArgumentParser(description="전처리 스케줄러")
    parser.add_argument("--raw-dir", type=Path, default=None, help="원본 DXF 디렉토리")
    parser.add_argument("--processed-dir", type=Path, default=None, help="처리 결과 디렉토리")
    parser.add_argument("--ai-server", default=AI_SERVER_URL, help="AI 서버 URL")
    parser.add_argument("--mock", action="store_true", help="vLLM mock 모드")
    parser.add_argument("--limit", type=int, default=None, help="처리 개수 제한")
    parser.add_argument("--list", action="store_true", help="미처리 건물 목록만 출력")

    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s - %(message)s",
    )

    if args.list:
        unprocessed = list_unprocessed_buildings(args.raw_dir, args.processed_dir)
        print(f"미처리 건물: {len(unprocessed)}개")
        for bid in unprocessed:
            print(f"  - {bid}")
        return

    result = run_preprocess_sync(
        raw_dir=args.raw_dir,
        processed_dir=args.processed_dir,
        ai_server_url=args.ai_server,
        mock=args.mock,
        limit=args.limit,
    )

    print(f"\n처리 완료:")
    print(f"  총: {result['total']}")
    print(f"  처리됨: {result['processed']}")
    print(f"  건너뜀: {result['skipped']}")
    print(f"  실패: {result['failed']}")


if __name__ == "__main__":
    main()
