"""
GLB 내보내기 모듈
분류된 레이어를 3D 모델(GLB)로 변환
"""
import json
import logging
from pathlib import Path
from typing import List, Dict, Optional, Tuple

import numpy as np
import pandas as pd

try:
    import trimesh
except ImportError:
    trimesh = None

from . import config

logger = logging.getLogger(__name__)


class GLBExporter:
    """
    CAD 엔티티를 GLB 3D 모델로 변환.

    사용법:
        exporter = GLBExporter()
        exporter.export_walls(df, "walls.glb", height=3.0)
    """

    def __init__(
        self,
        wall_height: float = config.DEFAULT_WALL_HEIGHT,
        wall_thickness: float = config.DEFAULT_WALL_THICKNESS,
    ):
        if trimesh is None:
            raise ImportError("trimesh 패키지가 필요합니다: pip install trimesh")

        self.wall_height = wall_height
        self.wall_thickness = wall_thickness

    def export_walls(
        self,
        df: pd.DataFrame,
        output_path: Path,
        layer_filter: Optional[List[str]] = None,
        class_filter: Optional[List[str]] = None,
    ) -> Path:
        """
        벽체 레이어를 GLB로 내보내기.

        Args:
            df: 엔티티 DataFrame (LINE, LWPOLYLINE 포함)
            output_path: 출력 GLB 경로
            layer_filter: 특정 레이어만 필터 (예: ["MURO", "WALL"])
            class_filter: 특정 분류만 필터 (예: ["wall"])

        Returns:
            저장된 파일 경로
        """
        output_path = Path(output_path)
        meshes = []

        # 필터링
        filtered_df = df.copy()
        if layer_filter:
            filtered_df = filtered_df[filtered_df["layer"].isin(layer_filter)]
        if class_filter and "predicted_class" in filtered_df.columns:
            filtered_df = filtered_df[filtered_df["predicted_class"].isin(class_filter)]

        # LINE 엔티티 처리
        lines_df = filtered_df[filtered_df["entity_type"] == "LINE"]
        for _, row in lines_df.iterrows():
            mesh = self._line_to_wall(
                start=(row["start_x"], row["start_y"]),
                end=(row["end_x"], row["end_y"]),
            )
            if mesh:
                meshes.append(mesh)

        # LWPOLYLINE 엔티티 처리
        poly_df = filtered_df[filtered_df["entity_type"] == "LWPOLYLINE"]
        for _, row in poly_df.iterrows():
            try:
                vertices = json.loads(row["vertices"])
                poly_meshes = self._polyline_to_walls(
                    vertices=vertices,
                    closed=row.get("closed", False),
                )
                meshes.extend(poly_meshes)
            except (json.JSONDecodeError, TypeError):
                continue

        if not meshes:
            logger.warning("내보낼 벽체 메시가 없습니다.")
            return None

        # 메시 병합 및 저장
        combined = trimesh.util.concatenate(meshes)
        combined.export(str(output_path))

        logger.info(f"GLB 저장: {output_path} ({len(meshes)} walls, {len(combined.vertices)} vertices)")
        return output_path

    def _line_to_wall(
        self,
        start: Tuple[float, float],
        end: Tuple[float, float],
    ) -> Optional["trimesh.Trimesh"]:
        """LINE을 벽 메시로 변환."""
        start = np.array(start)
        end = np.array(end)

        direction = end - start
        length = np.linalg.norm(direction)

        if length < 0.01:
            return None

        center = (start + end) / 2
        angle = np.arctan2(direction[1], direction[0])

        # 박스 생성 (길이 x 두께 x 높이)
        box = trimesh.creation.box(
            extents=[length, self.wall_thickness, self.wall_height]
        )

        # 회전 (Z축 기준)
        rotation = trimesh.transformations.rotation_matrix(angle, [0, 0, 1])
        box.apply_transform(rotation)

        # 이동 (중심점, Z축 절반 높이)
        translation = trimesh.transformations.translation_matrix(
            [center[0], center[1], self.wall_height / 2]
        )
        box.apply_transform(translation)

        return box

    def _polyline_to_walls(
        self,
        vertices: List[List[float]],
        closed: bool = False,
    ) -> List["trimesh.Trimesh"]:
        """LWPOLYLINE을 벽 메시 리스트로 변환."""
        meshes = []

        for i in range(len(vertices) - 1):
            mesh = self._line_to_wall(
                start=tuple(vertices[i]),
                end=tuple(vertices[i + 1]),
            )
            if mesh:
                meshes.append(mesh)

        # 닫힌 폴리라인: 마지막-첫 연결
        if closed and len(vertices) > 2:
            mesh = self._line_to_wall(
                start=tuple(vertices[-1]),
                end=tuple(vertices[0]),
            )
            if mesh:
                meshes.append(mesh)

        return meshes

    def export_by_class(
        self,
        df: pd.DataFrame,
        output_dir: Path,
        classes: Optional[List[str]] = None,
    ) -> Dict[str, Path]:
        """
        분류별로 개별 GLB 파일 생성.

        Args:
            df: 분류된 DataFrame (predicted_class 컬럼 필요)
            output_dir: 출력 디렉토리
            classes: 내보낼 분류 리스트 (기본: wall만)

        Returns:
            {class_name: output_path} 딕셔너리
        """
        output_dir = Path(output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)

        if "predicted_class" not in df.columns:
            raise ValueError("DataFrame에 predicted_class 컬럼이 없습니다.")

        classes = classes or ["wall"]
        results = {}

        for cls in classes:
            output_path = output_dir / f"{cls}.glb"
            path = self.export_walls(df, output_path, class_filter=[cls])
            if path:
                results[cls] = path

        return results


def export_from_csv(
    input_csv: Path,
    output_glb: Optional[Path] = None,
    layer_filter: Optional[List[str]] = None,
    class_filter: Optional[List[str]] = None,
    wall_height: float = config.DEFAULT_WALL_HEIGHT,
) -> Path:
    """
    CSV 파일에서 직접 GLB 내보내기.

    Args:
        input_csv: 입력 CSV 경로
        output_glb: 출력 GLB 경로 (기본: output/ 디렉토리)
        layer_filter: 레이어 필터
        class_filter: 분류 필터
        wall_height: 벽 높이

    Returns:
        저장된 GLB 경로
    """
    df = pd.read_csv(input_csv)

    if output_glb is None:
        output_glb = config.OUTPUT_DIR / f"{Path(input_csv).stem}_walls.glb"

    exporter = GLBExporter(wall_height=wall_height)
    return exporter.export_walls(df, output_glb, layer_filter, class_filter)


# CLI
if __name__ == "__main__":
    import argparse

    logging.basicConfig(level=logging.INFO)

    parser = argparse.ArgumentParser(description="GLB 내보내기")
    parser.add_argument("--input", "-i", type=Path, required=True, help="입력 CSV")
    parser.add_argument("--output", "-o", type=Path, help="출력 GLB")
    parser.add_argument("--height", type=float, default=3.0, help="벽 높이 (m)")
    parser.add_argument("--layers", nargs="+", help="레이어 필터")
    parser.add_argument("--classes", nargs="+", help="분류 필터")
    args = parser.parse_args()

    output_path = export_from_csv(
        args.input,
        args.output,
        layer_filter=args.layers,
        class_filter=args.classes,
        wall_height=args.height,
    )
    print(f"GLB 저장 완료: {output_path}")
