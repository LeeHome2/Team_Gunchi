"""
AI 파이프라인 통합 모듈
DXF → Feature 추출 → 분류 → GLB 내보내기 전체 워크플로우
"""
import json
import logging
from pathlib import Path
from typing import Optional, Dict, Any
from datetime import datetime

import pandas as pd

from . import config
from .extractor import FeatureExtractor
from .classifier import RuleBasedClassifier, MLClassifier, classify_dataframe
from .exporter import GLBExporter

logger = logging.getLogger(__name__)


class AIPipeline:
    """
    CAD AI 전체 파이프라인.

    사용법:
        pipeline = AIPipeline()

        # 전체 파이프라인 실행
        result = pipeline.run("input.dxf")

        # 개별 단계 실행
        df = pipeline.step_extract("input.dxf")
        df = pipeline.step_classify(df)
        pipeline.step_export(df, "output.glb")
    """

    def __init__(self, model_path: Optional[Path] = None):
        self.extractor = FeatureExtractor()
        self.exporter = GLBExporter()

        # 분류기 초기화 (모델 파일이 있으면 ML, 없으면 규칙 기반)
        if model_path and Path(model_path).exists():
            self.classifier = MLClassifier()
            self.classifier.load(model_path)
            logger.info(f"ML 모델 로드: {model_path}")
        else:
            self.classifier = RuleBasedClassifier()
            logger.info("규칙 기반 분류기 사용")

    def step_extract(self, dxf_path: str) -> pd.DataFrame:
        """Step 1: DXF에서 Feature 추출."""
        logger.info(f"[Step 1] Feature 추출: {dxf_path}")
        df = self.extractor.extract(dxf_path)
        return df

    def step_classify(self, df: pd.DataFrame) -> pd.DataFrame:
        """Step 2: 레이어 분류."""
        logger.info("[Step 2] 레이어 분류")
        df = classify_dataframe(df, self.classifier)
        return df

    def step_export(
        self,
        df: pd.DataFrame,
        output_path: Path,
        class_filter: Optional[list] = None,
    ) -> Path:
        """Step 3: GLB 내보내기."""
        logger.info(f"[Step 3] GLB 내보내기: {output_path}")
        class_filter = class_filter or ["wall"]
        return self.exporter.export_walls(df, output_path, class_filter=class_filter)

    def run(
        self,
        dxf_path: str,
        output_dir: Optional[Path] = None,
        save_intermediate: bool = True,
    ) -> Dict[str, Any]:
        """
        전체 파이프라인 실행.

        Args:
            dxf_path: 입력 DXF 파일 경로
            output_dir: 출력 디렉토리 (기본: config.OUTPUT_DIR)
            save_intermediate: 중간 결과 저장 여부

        Returns:
            {
                "source": str,
                "csv_path": Path,
                "labeled_csv_path": Path,
                "glb_path": Path,
                "stats": dict,
            }
        """
        dxf_path = Path(dxf_path)
        output_dir = output_dir or config.OUTPUT_DIR
        output_dir = Path(output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)

        source_name = dxf_path.stem
        result = {"source": source_name, "started_at": datetime.now().isoformat()}

        # Step 1: 추출
        df = self.step_extract(str(dxf_path))
        result["total_entities"] = len(df)

        if save_intermediate:
            csv_path = config.PROCESSED_DIR / f"{source_name}.csv"
            df.to_csv(csv_path, index=False, encoding="utf-8-sig")
            result["csv_path"] = str(csv_path)

            stats_path = config.PROCESSED_DIR / f"{source_name}_stats.json"
            stats = self.extractor.get_layer_stats(df)
            with open(stats_path, "w", encoding="utf-8") as f:
                json.dump(stats, f, ensure_ascii=False, indent=2)
            result["stats"] = stats

        # Step 2: 분류
        df = self.step_classify(df)
        result["classification"] = df["predicted_class"].value_counts().to_dict()

        if save_intermediate:
            labeled_path = config.LABELED_DIR / f"{source_name}.csv"
            df.to_csv(labeled_path, index=False, encoding="utf-8-sig")
            result["labeled_csv_path"] = str(labeled_path)

        # Step 3: GLB 내보내기
        glb_path = output_dir / f"{source_name}_walls.glb"
        exported = self.step_export(df, glb_path)
        if exported:
            result["glb_path"] = str(exported)

        # 예측 결과 JSON 저장
        prediction_path = config.PREDICTIONS_DIR / f"{source_name}.json"
        result["finished_at"] = datetime.now().isoformat()
        with open(prediction_path, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
        result["prediction_path"] = str(prediction_path)

        logger.info(f"파이프라인 완료: {source_name}")
        return result


def run_batch(
    input_dir: Optional[Path] = None,
    output_dir: Optional[Path] = None,
    model_path: Optional[Path] = None,
) -> list:
    """
    배치 파이프라인 실행.

    Args:
        input_dir: DXF 입력 디렉토리 (기본: config.RAW_DIR)
        output_dir: 출력 디렉토리 (기본: config.OUTPUT_DIR)
        model_path: 모델 파일 경로

    Returns:
        결과 리스트
    """
    input_dir = input_dir or config.RAW_DIR
    dxf_files = list(input_dir.glob("*.dxf")) + list(input_dir.glob("*.DXF"))

    if not dxf_files:
        logger.warning(f"DXF 파일 없음: {input_dir}")
        return []

    pipeline = AIPipeline(model_path=model_path)
    results = []

    for dxf_file in dxf_files:
        try:
            result = pipeline.run(str(dxf_file), output_dir)
            results.append(result)
        except Exception as e:
            logger.error(f"파이프라인 실패: {dxf_file.name} - {e}")
            results.append({"source": dxf_file.stem, "error": str(e)})

    logger.info(f"배치 완료: {len(results)} files")
    return results


# CLI
if __name__ == "__main__":
    import argparse

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
    )

    parser = argparse.ArgumentParser(description="CAD AI 파이프라인")
    parser.add_argument("--input", "-i", type=Path, help="DXF 파일 또는 디렉토리")
    parser.add_argument("--output", "-o", type=Path, help="출력 디렉토리")
    parser.add_argument("--model", "-m", type=Path, help="모델 파일 (pkl)")
    parser.add_argument("--batch", action="store_true", help="배치 모드")
    args = parser.parse_args()

    if args.batch or (args.input and args.input.is_dir()):
        results = run_batch(args.input, args.output, args.model)
        print(f"\n배치 완료: {len(results)} files")
    elif args.input and args.input.is_file():
        pipeline = AIPipeline(model_path=args.model)
        result = pipeline.run(str(args.input), args.output)
        print(f"\n파이프라인 완료:")
        print(f"  - 엔티티: {result.get('total_entities', 0)}")
        print(f"  - 분류: {result.get('classification', {})}")
        print(f"  - GLB: {result.get('glb_path', 'N/A')}")
    else:
        # 기본: RAW_DIR의 모든 파일 처리
        results = run_batch()
        print(f"\n배치 완료: {len(results)} files")
