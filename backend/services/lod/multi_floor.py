"""
다층 매스 생성 — 매니페스트 기반.

BuildingManifest 를 읽고 각 층별 LOD3 매스를 생성하여
z 축으로 스택. 출입구/창문 메타 포함 반환.
"""
from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

logger = logging.getLogger(__name__)


# 기본 경로
BASE_DIR = Path(__file__).parent.parent.parent  # backend/
DATA_DIR = BASE_DIR / "data"
RAW_DIR = DATA_DIR / "raw"
PROCESSED_DIR = DATA_DIR / "processed"


def build_multi_floor_mass(
    manifest: "BuildingManifest",
    floor_height: float = 3.5,
    output_path: Optional[str] = None,
) -> Dict[str, Any]:
    """매니페스트 기반 다층 매스 GLB 생성.

    각 층 매스를 LOD3 Simple 로 생성 후 z 축 stacking.

    Args:
        manifest: BuildingManifest 객체
        floor_height: 층당 높이 (m)
        output_path: 출력 GLB 경로 (None 이면 임시 파일)

    Returns:
        {
            "success": True,
            "floors_count": int,
            "total_height": float,
            "main_entrance": dict | None,
            "primary_window_faces": [dict, ...],
            "mesh_stats": {...},
        }
    """
    from .lod3_simple import build_lod3_simple

    if not manifest.floors:
        logger.warning(f"매니페스트에 층 정보 없음: {manifest.building_id}")
        return {
            "success": False,
            "error": "층 정보 없음",
            "floors_count": 0,
        }

    floors = sorted(manifest.floors, key=lambda f: f.floor_index)
    floor_glbs: List[Tuple[int, str]] = []
    temp_files: List[str] = []

    # 1. 각 층 GLB 생성
    for floor in floors:
        dxf_path = _find_dxf_path(manifest.building_id, floor.file_id)
        if not dxf_path or not dxf_path.exists():
            logger.warning(f"DXF 파일 없음: {floor.file_id}")
            continue

        # 임시 GLB 파일
        import tempfile
        temp_glb = tempfile.NamedTemporaryFile(
            suffix=".glb",
            delete=False,
            prefix=f"floor_{floor.floor_index}_"
        )
        temp_glb.close()
        temp_files.append(temp_glb.name)

        # bounds 처리
        bounds = None
        if floor.bounds:
            bounds = {
                "min_x": floor.bounds.min_x,
                "max_x": floor.bounds.max_x,
                "min_y": floor.bounds.min_y,
                "max_y": floor.bounds.max_y,
            }

        result = build_lod3_simple(
            dxf_path=str(dxf_path),
            wall_layers=floor.wall_layers,
            door_layers=floor.door_layers,
            window_layers=floor.window_layers,
            height=floor_height,
            output_path=temp_glb.name,
            bounds=bounds,
        )

        if result and result.get("success"):
            floor_glbs.append((floor.floor_index, temp_glb.name))
            logger.info(f"층 {floor.floor_index} GLB 생성 완료")
        else:
            logger.warning(f"층 {floor.floor_index} GLB 생성 실패")

    if not floor_glbs:
        # 임시 파일 정리
        for f in temp_files:
            try:
                os.unlink(f)
            except Exception:
                pass
        return {
            "success": False,
            "error": "생성된 층 없음",
            "floors_count": 0,
        }

    # 2. 층 결합 (trimesh 사용)
    try:
        import trimesh

        combined_meshes = []

        for floor_idx, glb_path in floor_glbs:
            scene = trimesh.load(glb_path)

            # Scene 인 경우 모든 geometry 추출
            if isinstance(scene, trimesh.Scene):
                for name, geom in scene.geometry.items():
                    if isinstance(geom, trimesh.Trimesh):
                        # Y 축 이동 (GLB 는 Y-up 좌표계)
                        translated = geom.copy()
                        translated.apply_translation([0, floor_idx * floor_height, 0])
                        combined_meshes.append(translated)
            elif isinstance(scene, trimesh.Trimesh):
                translated = scene.copy()
                translated.apply_translation([0, floor_idx * floor_height, 0])
                combined_meshes.append(translated)

        if not combined_meshes:
            raise ValueError("결합할 메쉬 없음")

        # 결합
        if len(combined_meshes) == 1:
            combined = combined_meshes[0]
        else:
            combined = trimesh.util.concatenate(combined_meshes)

        # 출력
        if output_path:
            final_path = output_path
        else:
            import tempfile
            temp_out = tempfile.NamedTemporaryFile(
                suffix=".glb",
                delete=False,
                prefix="multi_floor_"
            )
            temp_out.close()
            final_path = temp_out.name

        combined.export(final_path, file_type="glb")
        file_size = os.path.getsize(final_path)

        # 임시 파일 정리
        for f in temp_files:
            try:
                os.unlink(f)
            except Exception:
                pass

        # 출입구/창문 정보 추출
        main_entrance = None
        primary_window_faces = []

        for floor in floors:
            if floor.floor_index == 0 and floor.main_entrance:
                main_entrance = {
                    "center": list(floor.main_entrance.center),
                    "width": floor.main_entrance.width,
                    "confidence": floor.main_entrance.confidence,
                }
            if floor.primary_window_face:
                primary_window_faces.append({
                    "floor_index": floor.floor_index,
                    "midpoint": list(floor.primary_window_face.midpoint),
                    "direction": list(floor.primary_window_face.direction),
                    "length": floor.primary_window_face.length,
                    "window_count": floor.primary_window_face.window_count,
                    "confidence": floor.primary_window_face.confidence,
                })

        logger.info(f"다층 매스 생성 완료: {len(floors)}층, {file_size/1024:.1f} KB")

        return {
            "success": True,
            "floors_count": len(floor_glbs),
            "total_height": len(floor_glbs) * floor_height,
            "main_entrance": main_entrance,
            "primary_window_faces": primary_window_faces,
            "output_path": final_path,
            "mesh_stats": {
                "file_size_kb": file_size / 1024,
                "vertex_count": len(combined.vertices) if hasattr(combined, 'vertices') else 0,
                "face_count": len(combined.faces) if hasattr(combined, 'faces') else 0,
            },
        }

    except Exception as e:
        logger.exception(f"다층 매스 결합 실패: {e}")
        # 임시 파일 정리
        for f in temp_files:
            try:
                os.unlink(f)
            except Exception:
                pass
        return {
            "success": False,
            "error": str(e),
            "floors_count": 0,
        }


def _find_dxf_path(building_id: str, file_id: str) -> Optional[Path]:
    """DXF 파일 경로 찾기.

    여러 위치 탐색:
    - data/raw/manual/{building_id}/{file_id}.dxf
    - data/raw/manual/{file_id}.dxf
    - data/raw/{building_id}/{file_id}.dxf
    - data/raw/{file_id}.dxf
    """
    candidates = [
        RAW_DIR / "manual" / building_id / f"{file_id}.dxf",
        RAW_DIR / "manual" / building_id / f"{file_id}.DXF",
        RAW_DIR / "manual" / f"{file_id}.dxf",
        RAW_DIR / "manual" / f"{file_id}.DXF",
        RAW_DIR / building_id / f"{file_id}.dxf",
        RAW_DIR / building_id / f"{file_id}.DXF",
        RAW_DIR / f"{file_id}.dxf",
        RAW_DIR / f"{file_id}.DXF",
    ]

    # auto 디렉토리 검색 (auto_{date}_{building_id} 패턴)
    if building_id.startswith("auto_"):
        parts = building_id.split("_", 2)
        if len(parts) >= 3:
            date_part = parts[1]
            bid_part = parts[2]
            candidates.extend([
                RAW_DIR / "auto" / date_part / bid_part / f"{file_id}.dxf",
                RAW_DIR / "auto" / date_part / bid_part / f"{file_id}.DXF",
                RAW_DIR / "auto" / date_part / f"{file_id}.dxf",
                RAW_DIR / "auto" / date_part / f"{file_id}.DXF",
            ])

    for path in candidates:
        if path.exists():
            return path

    return None


# Type hint 용 import (런타임에는 무시)
if __name__ != "__main__":
    try:
        from services.preprocess.manifest import BuildingManifest
    except ImportError:
        BuildingManifest = Any
