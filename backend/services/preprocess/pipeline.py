"""
전처리 통합 파이프라인.

건물 1개 처리: DXF → 분류 → 평면도 검출 → 출입구/창문 → 시각화 → 매니페스트.
"""
from __future__ import annotations

import logging
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

import ezdxf
import httpx

from .manifest import (
    BuildingManifest,
    Bounds,
    Entrance,
    Floor,
    ProcessStatus,
    WindowFace,
    save_manifest,
    update_status,
)
from .openings import (
    WallSegment,
    extract_doors_simple,
    extract_windows_simple,
    find_main_entrance,
    find_primary_window_face,
    walls_from_centerline,
)
from .visualizer import (
    COLOR_DOOR,
    COLOR_WALL,
    COLOR_WINDOW,
    render_floorplans_marked,
    render_layer_overlay,
    render_openings_marked,
    render_original,
    render_overlay_4color,
    render_thumbnail,
)

logger = logging.getLogger(__name__)


# 기본 경로 설정
BASE_DIR = Path(__file__).parent.parent.parent  # backend/
DATA_DIR = BASE_DIR / "data"
RAW_DIR = DATA_DIR / "raw"
PROCESSED_DIR = DATA_DIR / "processed"

# AI 서버 URL (학과 서버)
AI_SERVER_URL = "http://localhost:8001"  # 실제 배포 시 환경변수로


async def call_ai_classify(
    dxf_path: Path,
    ai_server_url: str,
    timeout: float = 60.0,
) -> Dict:
    """학과 AI 서버 /api/classify 호출.

    Returns:
        {
            "layer_decisions": {"WALL": "wall", "DOOR": "door", ...},
            "predictions": [...],
            ...
        }
    """
    # DXF 파싱 → 엔티티 추출
    doc = ezdxf.readfile(str(dxf_path))
    msp = doc.modelspace()

    entities = []
    for i, entity in enumerate(msp):
        try:
            etype = entity.dxftype()
            layer = entity.dxf.layer if hasattr(entity.dxf, "layer") else "0"

            # 기본 피처 추출
            length = 0.0
            bbox_width = 0.0
            bbox_height = 0.0

            if etype == "LINE":
                start = entity.dxf.start
                end = entity.dxf.end
                length = ((end.x - start.x) ** 2 + (end.y - start.y) ** 2) ** 0.5
                bbox_width = abs(end.x - start.x)
                bbox_height = abs(end.y - start.y)

            elif etype == "LWPOLYLINE":
                points = list(entity.get_points(format="xy"))
                if len(points) >= 2:
                    for j in range(len(points) - 1):
                        dx = points[j + 1][0] - points[j][0]
                        dy = points[j + 1][1] - points[j][1]
                        length += (dx ** 2 + dy ** 2) ** 0.5
                    xs = [p[0] for p in points]
                    ys = [p[1] for p in points]
                    bbox_width = max(xs) - min(xs)
                    bbox_height = max(ys) - min(ys)

            elif etype == "ARC":
                length = entity.dxf.radius * abs(entity.dxf.end_angle - entity.dxf.start_angle) * 3.14159 / 180
                bbox_width = entity.dxf.radius * 2
                bbox_height = entity.dxf.radius * 2

            elif etype == "CIRCLE":
                length = entity.dxf.radius * 2 * 3.14159
                bbox_width = entity.dxf.radius * 2
                bbox_height = entity.dxf.radius * 2

            aspect_ratio = bbox_width / bbox_height if bbox_height > 0.001 else 0

            entities.append({
                "entity_id": str(i),
                "entity_type": etype,
                "raw_layer": layer,
                "length": length,
                "bbox_width": bbox_width,
                "bbox_height": bbox_height,
                "aspect_ratio": aspect_ratio,
            })

        except Exception:
            continue

    if not entities:
        return {"layer_decisions": {}, "predictions": []}

    # API 호출
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(
            f"{ai_server_url}/api/classify",
            json={
                "file_id": dxf_path.stem,
                "entities": entities,
                "log_predictions": False,
            },
        )
        response.raise_for_status()
        result = response.json()

    # layer_decisions 추출 (predictions 에서)
    layer_decisions = {}
    if "predictions" in result:
        for pred in result["predictions"]:
            layer = pred.get("raw_layer", "")
            label = pred.get("predicted_label", "other")
            if layer and layer not in layer_decisions:
                layer_decisions[layer] = label

    result["layer_decisions"] = layer_decisions
    return result


async def call_detect_floorplan(
    dxf_path: Path,
    ai_server_url: str,
    mock: bool = False,
    timeout: float = 120.0,
) -> Dict:
    """학과 AI 서버 /api/detect-floorplan 호출.

    Returns:
        {
            "floorplans_found": true,
            "floorplans": [{"label": "1F", "floor_index": 0, "bbox": {...}}, ...],
            "extent_dxf": {...}
        }
    """
    async with httpx.AsyncClient(timeout=timeout) as client:
        with open(dxf_path, "rb") as f:
            response = await client.post(
                f"{ai_server_url}/api/detect-floorplan",
                files={"file": (dxf_path.name, f, "application/octet-stream")},
                data={"mock": "true" if mock else "false"},
            )
            response.raise_for_status()
            return response.json()


async def preprocess_building(
    building_id: str,
    files: List[Path],
    ai_server_url: str = AI_SERVER_URL,
    mock: bool = False,
) -> BuildingManifest:
    """건물 1개 처리. 호출 즉시 status.json 업데이트 + 모든 PNG 생성."""
    output_dir = PROCESSED_DIR / building_id
    output_dir.mkdir(parents=True, exist_ok=True)
    layers_dir = output_dir / "layers"
    layers_dir.mkdir(exist_ok=True)

    update_status(building_id, "running", "init", 0, processed_dir=PROCESSED_DIR)
    floors: List[Floor] = []

    try:
        total_files = len(files)
        for file_idx, dxf in enumerate(files):
            file_id = dxf.stem
            base_progress = int((file_idx / total_files) * 80)

            # 1. 원본 렌더링
            update_status(building_id, "running", "render", base_progress + 5, processed_dir=PROCESSED_DIR)
            render_original(dxf, output_dir / f"original_{file_id}.png")
            render_thumbnail(dxf, output_dir / f"thumb_{file_id}.png")

            # 2. 분류 (학과서버 /api/classify)
            update_status(building_id, "running", "classify", base_progress + 15, processed_dir=PROCESSED_DIR)
            try:
                classify_result = await call_ai_classify(dxf, ai_server_url)
                layer_decisions = classify_result.get("layer_decisions", {})
            except Exception as e:
                logger.warning(f"분류 실패 {dxf.name}: {e}")
                layer_decisions = {}

            wall_layers = [l for l, c in layer_decisions.items() if c == "wall"]
            door_layers = [l for l, c in layer_decisions.items() if c == "door"]
            window_layers = [l for l, c in layer_decisions.items() if c == "window"]

            # 3. 평면도 검출 (학과서버 /api/detect-floorplan)
            update_status(building_id, "running", "detect_floorplan", base_progress + 30, processed_dir=PROCESSED_DIR)
            try:
                floorplan_result = await call_detect_floorplan(dxf, ai_server_url, mock=mock)
            except Exception as e:
                logger.warning(f"평면도 검출 실패 {dxf.name}: {e}")
                floorplan_result = {
                    "floorplans_found": False,
                    "floorplans": [],
                    "extent_dxf": {"min_x": 0, "min_y": 0, "max_x": 1, "max_y": 1},
                }

            # 4. 출입구/창문 분석 (휴리스틱, AWS 측)
            update_status(building_id, "running", "openings", base_progress + 45, processed_dir=PROCESSED_DIR)
            main_entrance = None
            primary_window = None

            try:
                doc = ezdxf.readfile(str(dxf))

                # centerline 추출 시도
                walls: List[WallSegment] = []
                try:
                    from ..lod.centerline import reconstruct_centerline
                    centerline = reconstruct_centerline(str(dxf), wall_layers)
                    walls = walls_from_centerline(centerline)
                except Exception:
                    # centerline 실패 시 간단한 벽 추출
                    pass

                # 문/창문 추출
                doors = extract_doors_simple(doc, door_layers)
                windows = extract_windows_simple(doc, window_layers)

                # 메인 출입구 / 주 창문면 찾기
                if walls and doors:
                    main_entrance = find_main_entrance(doors, walls)
                if walls and windows:
                    primary_window = find_primary_window_face(windows, walls)

            except Exception as e:
                logger.warning(f"출입구/창문 분석 실패 {dxf.name}: {e}")

            # 5. 시각화 (Phase B)
            update_status(building_id, "running", "visualize", base_progress + 60, processed_dir=PROCESSED_DIR)

            # 4색 합성
            if layer_decisions:
                render_overlay_4color(dxf, layer_decisions, output_dir / f"overlay_{file_id}.png")

            # 개별 레이어
            if wall_layers:
                render_layer_overlay(dxf, wall_layers, COLOR_WALL, layers_dir / f"wall_{file_id}.png")
            if door_layers:
                render_layer_overlay(dxf, door_layers, COLOR_DOOR, layers_dir / f"door_{file_id}.png")
            if window_layers:
                render_layer_overlay(dxf, window_layers, COLOR_WINDOW, layers_dir / f"window_{file_id}.png")

            # 평면도 마킹
            if floorplan_result.get("floorplans"):
                render_floorplans_marked(
                    dxf,
                    floorplan_result["floorplans"],
                    floorplan_result.get("extent_dxf", {}),
                    output_dir / f"floorplans_{file_id}.png",
                )

            # 출입구/창문 마킹
            render_openings_marked(
                dxf,
                main_entrance,
                primary_window,
                output_dir / f"openings_{file_id}.png",
            )

            # 6. Floor 객체 생성
            detected_floors = floorplan_result.get("floorplans", [])
            if not detected_floors:
                # 평면도 검출 실패 시 파일 전체를 하나의 층으로
                detected_floors = [{"label": file_id, "floor_index": -1, "bbox": None}]

            for fp in detected_floors:
                floor_index = fp.get("floor_index", -1)
                if floor_index == -999:
                    floor_index = -1

                bounds = None
                if fp.get("bbox"):
                    extent = floorplan_result.get("extent_dxf", {})
                    if extent:
                        from .visualizer import _normalized_to_dxf
                        bbox_dxf = _normalized_to_dxf(fp["bbox"], extent)
                        bounds = Bounds(**bbox_dxf)

                entrance_obj = None
                if main_entrance:
                    entrance_obj = Entrance(
                        center=tuple(main_entrance.get("center", (0, 0))),
                        width=main_entrance.get("width", 0),
                        wall_segment_id=str(main_entrance.get("wall_segment_id")) if main_entrance.get("wall_segment_id") else None,
                        confidence=main_entrance.get("confidence", 1.0),
                    )

                window_obj = None
                if primary_window:
                    window_obj = WindowFace(
                        midpoint=tuple(primary_window.get("midpoint", (0, 0))),
                        direction=tuple(primary_window.get("direction", (1, 0))),
                        length=primary_window.get("length", 0),
                        window_count=primary_window.get("window_count", 0),
                        total_window_width=primary_window.get("total_window_width", 0),
                        confidence=primary_window.get("confidence", 1.0),
                    )

                floors.append(Floor(
                    floor_index=floor_index,
                    floor_label=fp.get("label", f"floor_{len(floors)}"),
                    file_id=file_id,
                    bounds=bounds,
                    wall_layers=wall_layers,
                    door_layers=door_layers,
                    window_layers=window_layers,
                    main_entrance=entrance_obj,
                    primary_window_face=window_obj,
                ))

        # 7. floor_index 정렬 + 매니페스트 저장
        floors.sort(key=lambda f: (f.floor_index if f.floor_index >= 0 else 999, f.floor_label))

        # floor_index 가 -1 이면 순서대로 0부터 부여
        unassigned = [f for f in floors if f.floor_index < 0]
        for i, f in enumerate(unassigned):
            f.floor_index = i

        # 메인 출입구는 1층(floor_index=0) 에만 유지
        for f in floors:
            if f.floor_index != 0:
                f.main_entrance = None

        manifest = BuildingManifest(
            building_id=building_id,
            files=[f.name for f in files],
            floors=floors,
            coordinate_alignment="bbox_centroid",
            created_at=datetime.utcnow().isoformat(),
            updated_at=datetime.utcnow().isoformat(),
        )
        save_manifest(manifest, output_dir / "manifest.json")
        update_status(building_id, "completed", "done", 100, processed_dir=PROCESSED_DIR)

        return manifest

    except Exception as e:
        logger.exception(f"전처리 실패: {building_id}")
        update_status(building_id, "failed", "error", error=str(e), processed_dir=PROCESSED_DIR)
        raise


async def preprocess_building_sync(
    building_id: str,
    files: List[Path],
    ai_server_url: str = AI_SERVER_URL,
    mock: bool = False,
) -> BuildingManifest:
    """동기 버전 (asyncio.run 래퍼)."""
    import asyncio
    return asyncio.run(preprocess_building(building_id, files, ai_server_url, mock))
