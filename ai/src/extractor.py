"""
DXF Feature 추출 모듈
DXF 파일에서 엔티티를 추출하여 CSV로 저장
"""
import json
import math
import logging
from pathlib import Path
from typing import Optional, List, Dict, Any

import ezdxf
import pandas as pd

from . import config

logger = logging.getLogger(__name__)


class FeatureExtractor:
    """
    DXF 파일에서 기하 데이터를 추출하는 클래스.

    사용법:
        extractor = FeatureExtractor()
        df = extractor.extract("input.dxf")
        extractor.save_csv(df, "output.csv")
    """

    def __init__(self):
        self.doc = None
        self.source_name = ""

    def extract(self, dxf_path: str) -> pd.DataFrame:
        """
        DXF 파일에서 모든 엔티티를 추출하여 DataFrame으로 반환.

        Args:
            dxf_path: DXF 파일 경로

        Returns:
            엔티티별 속성이 담긴 DataFrame
        """
        dxf_path = Path(dxf_path)
        self.source_name = dxf_path.stem
        self.doc = ezdxf.readfile(str(dxf_path))
        msp = self.doc.modelspace()

        rows = []
        for entity in msp:
            row = self._extract_entity(entity)
            if row:
                row["source"] = self.source_name
                rows.append(row)

        df = pd.DataFrame(rows)
        logger.info(f"추출 완료: {self.source_name} ({len(df)} entities)")
        return df

    def _extract_entity(self, entity) -> Optional[Dict[str, Any]]:
        """엔티티 타입에 따라 속성 추출."""
        etype = entity.dxftype()

        if etype not in config.TARGET_ENTITY_TYPES:
            return None

        row = {
            "entity_type": etype,
            "layer": entity.dxf.layer,
        }

        try:
            if etype == "LINE":
                row.update({
                    "start_x": round(entity.dxf.start.x, 4),
                    "start_y": round(entity.dxf.start.y, 4),
                    "start_z": round(entity.dxf.start.z, 4),
                    "end_x": round(entity.dxf.end.x, 4),
                    "end_y": round(entity.dxf.end.y, 4),
                    "end_z": round(entity.dxf.end.z, 4),
                    "length": round(math.dist(
                        (entity.dxf.start.x, entity.dxf.start.y),
                        (entity.dxf.end.x, entity.dxf.end.y)
                    ), 4),
                })

            elif etype == "CIRCLE":
                row.update({
                    "center_x": round(entity.dxf.center.x, 4),
                    "center_y": round(entity.dxf.center.y, 4),
                    "radius": round(entity.dxf.radius, 4),
                    "area": round(math.pi * entity.dxf.radius ** 2, 4),
                })

            elif etype == "ARC":
                row.update({
                    "center_x": round(entity.dxf.center.x, 4),
                    "center_y": round(entity.dxf.center.y, 4),
                    "radius": round(entity.dxf.radius, 4),
                    "start_angle": round(entity.dxf.start_angle, 4),
                    "end_angle": round(entity.dxf.end_angle, 4),
                })

            elif etype == "LWPOLYLINE":
                points = list(entity.get_points(format="xy"))
                row.update({
                    "vertices": json.dumps([[round(p[0], 4), round(p[1], 4)] for p in points]),
                    "vertex_count": len(points),
                    "closed": entity.closed,
                })

            elif etype in ("TEXT", "MTEXT"):
                text = entity.dxf.text if etype == "TEXT" else entity.text
                insert = entity.dxf.insert
                row.update({
                    "text": str(text),
                    "insert_x": round(insert.x, 4),
                    "insert_y": round(insert.y, 4),
                })

            elif etype == "INSERT":
                insert = entity.dxf.insert
                row.update({
                    "block_name": entity.dxf.name,
                    "insert_x": round(insert.x, 4),
                    "insert_y": round(insert.y, 4),
                    "rotation": round(getattr(entity.dxf, "rotation", 0), 4),
                })

            elif etype == "DIMENSION":
                row.update({
                    "dimension_type": getattr(entity.dxf, "dimtype", 0),
                })

        except Exception as e:
            logger.debug(f"엔티티 추출 실패 ({etype}): {e}")
            return None

        return row

    def get_layers(self) -> List[str]:
        """도면의 모든 레이어명 반환."""
        if not self.doc:
            return []
        return [layer.dxf.name for layer in self.doc.layers]

    def get_layer_stats(self, df: pd.DataFrame) -> Dict[str, Any]:
        """레이어별 통계 생성."""
        stats = {
            "source": self.source_name,
            "total_entities": len(df),
            "entity_type_counts": df["entity_type"].value_counts().to_dict(),
            "layer_counts": df["layer"].value_counts().to_dict(),
            "layers": self.get_layers(),
        }
        return stats

    def save_csv(self, df: pd.DataFrame, output_path: Optional[str] = None) -> Path:
        """DataFrame을 CSV로 저장."""
        if output_path is None:
            output_path = config.PROCESSED_DIR / f"{self.source_name}.csv"
        else:
            output_path = Path(output_path)

        df.to_csv(output_path, index=False, encoding="utf-8-sig")
        logger.info(f"CSV 저장: {output_path}")
        return output_path

    def save_stats(self, df: pd.DataFrame, output_path: Optional[str] = None) -> Path:
        """통계를 JSON으로 저장."""
        if output_path is None:
            output_path = config.PROCESSED_DIR / f"{self.source_name}_stats.json"
        else:
            output_path = Path(output_path)

        stats = self.get_layer_stats(df)
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(stats, f, ensure_ascii=False, indent=2)

        logger.info(f"통계 저장: {output_path}")
        return output_path


def extract_all(input_dir: Optional[Path] = None) -> List[pd.DataFrame]:
    """
    디렉토리 내 모든 DXF 파일 추출.

    Args:
        input_dir: DXF 파일 디렉토리 (기본: config.RAW_DIR)

    Returns:
        DataFrame 리스트
    """
    input_dir = input_dir or config.RAW_DIR
    dxf_files = list(input_dir.glob("*.dxf")) + list(input_dir.glob("*.DXF"))

    if not dxf_files:
        logger.warning(f"DXF 파일 없음: {input_dir}")
        return []

    extractor = FeatureExtractor()
    results = []

    for dxf_file in dxf_files:
        try:
            df = extractor.extract(str(dxf_file))
            extractor.save_csv(df)
            extractor.save_stats(df)
            results.append(df)
        except Exception as e:
            logger.error(f"추출 실패: {dxf_file.name} - {e}")

    logger.info(f"전체 추출 완료: {len(results)}/{len(dxf_files)} 파일")
    return results


# CLI
if __name__ == "__main__":
    import argparse

    logging.basicConfig(level=logging.INFO)

    parser = argparse.ArgumentParser(description="DXF Feature 추출")
    parser.add_argument("--input", "-i", type=Path, help="DXF 파일 또는 디렉토리")
    parser.add_argument("--output", "-o", type=Path, help="출력 경로")
    args = parser.parse_args()

    if args.input and args.input.is_file():
        extractor = FeatureExtractor()
        df = extractor.extract(str(args.input))
        extractor.save_csv(df, args.output)
        extractor.save_stats(df)
        print(f"추출 완료: {len(df)} entities")
    else:
        input_dir = args.input or config.RAW_DIR
        results = extract_all(input_dir)
        print(f"전체 추출 완료: {len(results)} files")
