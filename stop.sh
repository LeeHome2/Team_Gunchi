#!/bin/bash
# Building Cesium — 서버 종료 스크립트
echo "프로세스 종료 중..."
pkill -f "uvicorn main:app" 2>/dev/null && echo "  → 백엔드 종료됨" || echo "  → 백엔드 미실행"
pkill -f "next-server\|next start" 2>/dev/null && echo "  → 프론트엔드 종료됨" || echo "  → 프론트엔드 미실행"
echo "완료!"
