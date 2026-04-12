"""
레이어 분류 모듈
레이어명을 건축 요소로 분류 (wall, door, window, etc.)
"""
import pickle
import logging
from pathlib import Path
from typing import List, Dict, Optional, Tuple
from collections import Counter

import pandas as pd

from . import config

logger = logging.getLogger(__name__)


class LayerClassifier:
    """
    레이어 분류기 인터페이스.

    사용법:
        # 규칙 기반 분류 (베이스라인)
        classifier = RuleBasedClassifier()
        predictions = classifier.predict(["MURO", "PUERTAS", "TEXTO"])

        # ML 기반 분류 (학습 필요)
        classifier = MLClassifier()
        classifier.fit(X_train, y_train)
        predictions = classifier.predict(layer_names)
    """

    def predict(self, layer_names: List[str]) -> List[str]:
        """레이어명 리스트를 분류 레이블로 변환."""
        raise NotImplementedError

    def save(self, path: Path):
        """모델 저장."""
        raise NotImplementedError

    def load(self, path: Path):
        """모델 로드."""
        raise NotImplementedError


class RuleBasedClassifier(LayerClassifier):
    """
    규칙 기반 레이어 분류기 (베이스라인).
    config.LAYER_PATTERNS의 키워드 매칭으로 분류.
    """

    def __init__(self, patterns: Optional[Dict[str, List[str]]] = None):
        self.patterns = patterns or config.LAYER_PATTERNS

    def predict(self, layer_names: List[str]) -> List[str]:
        """레이어명을 분류."""
        return [self._classify_single(name) for name in layer_names]

    def _classify_single(self, layer_name: str) -> str:
        """단일 레이어명 분류."""
        layer_upper = layer_name.upper()

        for class_name, keywords in self.patterns.items():
            for keyword in keywords:
                if keyword.upper() in layer_upper:
                    return class_name

        return "other"

    def predict_proba(self, layer_names: List[str]) -> List[Dict[str, float]]:
        """분류 확률 (규칙 기반은 0 또는 1)."""
        results = []
        for name in layer_names:
            pred = self._classify_single(name)
            proba = {cls: 0.0 for cls in config.LAYER_CLASSES}
            proba[pred] = 1.0
            results.append(proba)
        return results

    def save(self, path: Path):
        """패턴 저장."""
        path = Path(path)
        with open(path, "wb") as f:
            pickle.dump({"patterns": self.patterns}, f)
        logger.info(f"규칙 저장: {path}")

    def load(self, path: Path):
        """패턴 로드."""
        path = Path(path)
        with open(path, "rb") as f:
            data = pickle.load(f)
        self.patterns = data["patterns"]
        logger.info(f"규칙 로드: {path}")


class MLClassifier(LayerClassifier):
    """
    ML 기반 레이어 분류기.
    scikit-learn 모델을 사용한 학습/예측.
    """

    def __init__(self):
        self.model = None
        self.vectorizer = None

    def fit(self, X: List[str], y: List[str]):
        """
        모델 학습.

        Args:
            X: 레이어명 리스트
            y: 분류 레이블 리스트
        """
        from sklearn.feature_extraction.text import TfidfVectorizer
        from sklearn.ensemble import RandomForestClassifier

        # 레이어명을 TF-IDF 벡터로 변환
        self.vectorizer = TfidfVectorizer(
            analyzer="char_wb",
            ngram_range=(2, 4),
            lowercase=True,
        )
        X_vec = self.vectorizer.fit_transform(X)

        # Random Forest 학습
        self.model = RandomForestClassifier(
            n_estimators=100,
            max_depth=10,
            random_state=42,
        )
        self.model.fit(X_vec, y)

        logger.info(f"모델 학습 완료: {len(X)} samples")

    def predict(self, layer_names: List[str]) -> List[str]:
        """예측."""
        if not self.model or not self.vectorizer:
            raise ValueError("모델이 학습되지 않았습니다. fit()을 먼저 호출하세요.")

        X_vec = self.vectorizer.transform(layer_names)
        return self.model.predict(X_vec).tolist()

    def predict_proba(self, layer_names: List[str]) -> List[Dict[str, float]]:
        """분류 확률."""
        if not self.model or not self.vectorizer:
            raise ValueError("모델이 학습되지 않았습니다.")

        X_vec = self.vectorizer.transform(layer_names)
        probas = self.model.predict_proba(X_vec)
        classes = self.model.classes_

        results = []
        for proba in probas:
            results.append({cls: float(p) for cls, p in zip(classes, proba)})
        return results

    def save(self, path: Path):
        """모델 저장."""
        path = Path(path)
        with open(path, "wb") as f:
            pickle.dump({
                "model": self.model,
                "vectorizer": self.vectorizer,
            }, f)
        logger.info(f"모델 저장: {path}")

    def load(self, path: Path):
        """모델 로드."""
        path = Path(path)
        with open(path, "rb") as f:
            data = pickle.load(f)
        self.model = data["model"]
        self.vectorizer = data["vectorizer"]
        logger.info(f"모델 로드: {path}")


def classify_dataframe(
    df: pd.DataFrame,
    classifier: Optional[LayerClassifier] = None,
    layer_column: str = "layer",
) -> pd.DataFrame:
    """
    DataFrame의 레이어 컬럼을 분류하여 predicted_class 컬럼 추가.

    Args:
        df: 입력 DataFrame
        classifier: 분류기 (기본: RuleBasedClassifier)
        layer_column: 레이어 컬럼명

    Returns:
        predicted_class 컬럼이 추가된 DataFrame
    """
    if classifier is None:
        classifier = RuleBasedClassifier()

    df = df.copy()
    layer_names = df[layer_column].fillna("").tolist()
    predictions = classifier.predict(layer_names)
    df["predicted_class"] = predictions

    # 분류 통계
    class_counts = Counter(predictions)
    logger.info(f"분류 완료: {dict(class_counts)}")

    return df


def create_labeled_dataset(
    input_csv: Path,
    output_csv: Optional[Path] = None,
    classifier: Optional[LayerClassifier] = None,
) -> Path:
    """
    CSV 파일에 분류 레이블을 추가하여 저장.

    Args:
        input_csv: 입력 CSV 경로
        output_csv: 출력 CSV 경로 (기본: labeled/ 디렉토리)
        classifier: 분류기

    Returns:
        저장된 파일 경로
    """
    df = pd.read_csv(input_csv)
    df = classify_dataframe(df, classifier)

    if output_csv is None:
        output_csv = config.LABELED_DIR / input_csv.name

    df.to_csv(output_csv, index=False, encoding="utf-8-sig")
    logger.info(f"라벨 데이터 저장: {output_csv}")
    return output_csv


# CLI
if __name__ == "__main__":
    import argparse

    logging.basicConfig(level=logging.INFO)

    parser = argparse.ArgumentParser(description="레이어 분류")
    parser.add_argument("--input", "-i", type=Path, required=True, help="입력 CSV")
    parser.add_argument("--output", "-o", type=Path, help="출력 CSV")
    parser.add_argument("--model", "-m", type=Path, help="모델 파일 (pkl)")
    args = parser.parse_args()

    classifier = RuleBasedClassifier()
    if args.model and args.model.exists():
        classifier = MLClassifier()
        classifier.load(args.model)

    output_path = create_labeled_dataset(args.input, args.output, classifier)
    print(f"분류 완료: {output_path}")
