#!/bin/bash
# ============================================================================
# Building Cesium — 서버 시작 스크립트
# 사용법: ./start.sh
# 서버 재시작 후 이 스크립트만 실행하면 백엔드 + 프론트엔드 모두 시작됩니다.
# ============================================================================

set -e
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"

# --- Swap 확인 및 복구 ---
if ! swapon --show | grep -q swapfile; then
    echo "[0/4] Swap 복구 중..."
    if [ ! -f /swapfile ]; then
        sudo dd if=/dev/zero of=/swapfile bs=128M count=16 2>/dev/null
        sudo chmod 600 /swapfile
        sudo mkswap /swapfile
    fi
    sudo swapon /swapfile
    echo "  → Swap 2GB 활성화 완료"
fi

echo "=========================================="
echo " Building Cesium 서버 시작"
echo "=========================================="

# --- 기존 프로세스 종료 ---
echo "[1/4] 기존 프로세스 정리..."
pkill -f "uvicorn main:app" 2>/dev/null || true
pkill -f "next start" 2>/dev/null || true
sleep 1

# --- 백엔드 시작 ---
echo "[2/4] 백엔드 시작 (포트 8000)..."
cd "$PROJECT_DIR/backend"
if [ ! -d "venv" ]; then
    echo "  → venv 생성 중..."
    python3 -m venv venv
    source venv/bin/activate
    pip install -r requirements.txt -q
else
    source venv/bin/activate
fi
nohup uvicorn main:app --host 0.0.0.0 --port 8000 &> "$PROJECT_DIR/backend.log" &
BACKEND_PID=$!
echo "  → 백엔드 PID: $BACKEND_PID"

# --- 백엔드 헬스체크 대기 ---
echo "[3/4] 백엔드 준비 대기..."
for i in {1..15}; do
    if curl -s http://localhost:8000/health > /dev/null 2>&1; then
        echo "  → 백엔드 정상 작동!"
        break
    fi
    if [ $i -eq 15 ]; then
        echo "  → ⚠ 백엔드 시작 실패. backend.log 확인하세요."
        cat "$PROJECT_DIR/backend.log" | tail -20
        exit 1
    fi
    sleep 2
done

# --- 프론트엔드 시작 ---
echo "[4/4] 프론트엔드 시작 (포트 3000)..."
cd "$PROJECT_DIR/frontend"
if [ ! -d "node_modules" ]; then
    echo "  → npm install 중..."
    npm install
fi
if [ ! -d ".next" ]; then
    echo "  → 빌드 중 (최초 1회)..."
    npm run build
fi
nohup npm run start -- -p 3000 &> "$PROJECT_DIR/frontend.log" &
FRONTEND_PID=$!
echo "  → 프론트엔드 PID: $FRONTEND_PID"

sleep 3

# --- 결과 출력 ---
PUBLIC_IP=$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || echo "IP확인불가")
echo ""
echo "=========================================="
echo " 시작 완료!"
echo "=========================================="
echo " 프론트엔드: http://${PUBLIC_IP}:3000"
echo " 백엔드 API: http://${PUBLIC_IP}:8000/docs"
echo ""
echo " 로그 확인:"
echo "   tail -f $PROJECT_DIR/backend.log"
echo "   tail -f $PROJECT_DIR/frontend.log"
echo ""
echo " 종료: ./stop.sh"
echo "=========================================="
