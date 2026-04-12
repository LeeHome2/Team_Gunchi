# CAD AI Module

CAD 도면 레이어 자동 분류 모델 개발 환경

## 디렉토리 구조

```
ai/
├── data/
│   ├── raw/           # 원본 DXF 파일
│   ├── processed/     # 추출된 CSV/JSON
│   ├── labeled/       # 라벨링된 학습 데이터
│   └── output/        # GLB, 예측 결과
├── src/               # 소스 코드
├── notebooks/         # Jupyter 노트북
├── models/            # 학습된 모델 (.pkl)
└── tests/             # 테스트 코드
```

## 설치

```bash
cd ai
pip install -r requirements.txt
```

## 사용법

### 1. Feature 추출 (DXF → CSV)

```bash
# 단일 파일
python -m src.extractor -i data/raw/sample.dxf

# 전체 파일
python -m src.extractor
```

**출력:**
- `data/processed/{name}.csv` - 엔티티 데이터
- `data/processed/{name}_stats.json` - 레이어 통계

### 2. 레이어 분류

```bash
# 규칙 기반 분류
python -m src.classifier -i data/processed/sample.csv

# ML 모델 사용
python -m src.classifier -i data/processed/sample.csv -m models/layer_classifier.pkl
```

**출력:**
- `data/labeled/{name}.csv` - predicted_class 컬럼 추가

### 3. GLB 내보내기

```bash
# 벽체만 내보내기
python -m src.exporter -i data/labeled/sample.csv --classes wall

# 특정 레이어 내보내기
python -m src.exporter -i data/processed/sample.csv --layers MURO WALL
```

**출력:**
- `data/output/{name}_walls.glb` - 3D 모델

### 4. 전체 파이프라인

```bash
# 단일 파일
python -m src.pipeline -i data/raw/sample.dxf

# 배치 처리
python -m src.pipeline --batch
```

## Input/Output 명세

### Input: CSV 컬럼 구조

| 컬럼 | 타입 | 설명 |
|------|------|------|
| entity_type | str | LINE, CIRCLE, ARC, LWPOLYLINE, ... |
| layer | str | 레이어명 (분류 대상) |
| start_x, start_y | float | LINE 시작점 |
| end_x, end_y | float | LINE 끝점 |
| center_x, center_y | float | CIRCLE/ARC 중심 |
| radius | float | 반지름 |
| vertices | json | LWPOLYLINE 꼭지점 |
| text | str | TEXT/MTEXT 내용 |

### Output: 분류 레이블

| 레이블 | 설명 |
|--------|------|
| wall | 벽체 |
| door | 문 |
| window | 창문 |
| stair | 계단 |
| furniture | 가구 |
| dimension | 치수 |
| text | 텍스트 |
| other | 기타 |

## 분류기 개발 가이드

### 규칙 기반 (Baseline)

`src/config.py`의 `LAYER_PATTERNS`에 키워드 추가:

```python
LAYER_PATTERNS = {
    "wall": ["WALL", "MURO", "벽"],
    "door": ["DOOR", "PUERTA", "문"],
    ...
}
```

### ML 기반 모델

```python
from src.classifier import MLClassifier

# 학습
classifier = MLClassifier()
classifier.fit(X_train, y_train)  # X: 레이어명 리스트, y: 레이블 리스트
classifier.save("models/layer_classifier.pkl")

# 예측
classifier.load("models/layer_classifier.pkl")
predictions = classifier.predict(layer_names)
```

## 노트북

- `notebooks/01_data_exploration.ipynb` - 데이터 탐색
- `notebooks/02_feature_engineering.ipynb` - 특성 엔지니어링
- `notebooks/03_model_training.ipynb` - 모델 학습

## API

파이프라인 완료 후 `backend/` API와 연동:

```python
# backend/main.py
from ai.src.pipeline import AIPipeline

pipeline = AIPipeline(model_path="ai/models/layer_classifier.pkl")
result = pipeline.run("uploads/site.dxf")
```
