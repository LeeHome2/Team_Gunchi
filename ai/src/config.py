"""
CAD AI 모듈 설정
경로 및 분류 레이블 정의
"""
from pathlib import Path

# 기본 경로
AI_DIR = Path(__file__).parent.parent
DATA_DIR = AI_DIR / "data"
RAW_DIR = DATA_DIR / "raw"
PROCESSED_DIR = DATA_DIR / "processed"
LABELED_DIR = DATA_DIR / "labeled"
OUTPUT_DIR = DATA_DIR / "output"
PREDICTIONS_DIR = OUTPUT_DIR / "predictions"
MODELS_DIR = AI_DIR / "models"

# 디렉토리 생성
for d in [RAW_DIR, PROCESSED_DIR, LABELED_DIR, OUTPUT_DIR, PREDICTIONS_DIR, MODELS_DIR]:
    d.mkdir(parents=True, exist_ok=True)

# 분류 레이블
LAYER_CLASSES = [
    "wall",       # 벽체
    "door",       # 문
    "window",     # 창문
    "stair",      # 계단
    "furniture",  # 가구
    "dimension",  # 치수
    "text",       # 텍스트
    "other",      # 기타
]

# 레이어명 → 클래스 매핑 패턴 (규칙 기반 베이스라인)
LAYER_PATTERNS = {
    "wall": [
        "WALL", "A-WALL", "MURO", "MUROS", "벽", "벽체",
        "MURO BAJO", "MuroBaj", "Medianeras"
    ],
    "door": [
        "DOOR", "A-DOOR", "PUERTAS", "PUERTA", "문"
    ],
    "window": [
        "WINDOW", "A-WINDOW", "VENTANA", "VENTANAS", "창", "창문"
    ],
    "stair": [
        "STAIR", "ESCALERA", "계단"
    ],
    "furniture": [
        "FURN", "FURNITURE", "MUEBLES", "MOBILIARIO", "가구",
        "SANITARIOS", "A_MUEBLES"
    ],
    "dimension": [
        "DIM", "DIMENSION", "COTAS", "치수"
    ],
    "text": [
        "TEXT", "TEXTO", "TEXTOS", "MTEXT", "ANNO", "주석"
    ],
}

# Feature 추출 대상 엔티티 타입
TARGET_ENTITY_TYPES = [
    "LINE", "CIRCLE", "ARC", "ELLIPSE",
    "LWPOLYLINE", "POLYLINE", "SPLINE",
    "TEXT", "MTEXT", "INSERT", "DIMENSION",
]

# GLB 내보내기 설정
DEFAULT_WALL_HEIGHT = 3.0  # meters
DEFAULT_WALL_THICKNESS = 0.15  # meters
