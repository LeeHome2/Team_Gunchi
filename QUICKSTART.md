# 빠른 시작 가이드

팀원을 위한 빠른 개발 시작 가이드

---

## 1. 환경 설정 (5분)

### Backend
```bash
cd backend
pip install -r requirements.txt
```

### Frontend
```bash
cd frontend
npm install
```

### 환경변수
```bash
# frontend/.env.local 생성
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_CESIUM_TOKEN=<팀 공유 토큰>
```

---

## 2. 실행 (2분)

터미널 2개 열기:

```bash
# 터미널 1: Backend
cd backend
python -m uvicorn main:app --reload --port 8000

# 터미널 2: Frontend
cd frontend
npm run dev
```

브라우저: http://localhost:3002

---

## 3. 테스트 (1분)

1. "샘플 데이터로 테스트" 클릭
2. "3D 매스 생성" 클릭
3. "건물 위치로 이동" 클릭
4. 건물 드래그해서 이동
5. "배치 검토 실행" 클릭

---

## 4. 파일 구조 (핵심만)

```
frontend/
├── components/
│   ├── CesiumViewer.tsx  ← 3D 뷰어 (담당: ?)
│   └── Sidebar.tsx       ← UI 컨트롤 (담당: ?)
├── store/
│   └── projectStore.ts   ← 상태관리
└── lib/
    ├── api.ts            ← API 호출
    ├── building.ts       ← 건물 유틸 (NEW)
    └── coordinates.ts    ← 좌표 유틸 (NEW)

backend/
├── main.py               ← API 엔드포인트
└── services/
    ├── dxf_parser.py     ← DXF 파싱 (담당: ?)
    ├── gltf_exporter.py  ← GLB 생성
    └── validation.py     ← 규정 검토 (NEW)
```

---

## 5. 주요 API

| API | 용도 |
|-----|------|
| `POST /api/upload-dxf` | DXF 업로드 |
| `POST /api/generate-mass` | 매스 생성 |
| `POST /api/validate-placement` | 규정 검토 |
| `GET /health` | 서버 상태 |

---

## 6. 내가 맡은 모듈 찾기

→ `MODULES.md` 파일 참조

---

## 7. 작업 시작

```bash
# 1. develop 브랜치에서 시작
git checkout develop
git pull

# 2. 기능 브랜치 생성
git checkout -b feature/module-x-기능명

# 3. 작업 후 커밋
git add .
git commit -m "[Module-X] 기능 설명"

# 4. PR 생성
git push origin feature/module-x-기능명
```

---

## 8. 문제 발생 시

### CORS 에러
```
backend/main.py에서 CORS origins 확인
현재: localhost:3000,3001,3002,3003 허용
```

### Cesium 토큰 에러
```
frontend/.env.local 파일 확인
NEXT_PUBLIC_CESIUM_TOKEN 설정 필요
```

### 포트 충돌
```
Frontend가 3002로 자동 변경됨 (3000, 3001 사용 중)
```

---

## 9. 연락처

- 프로젝트 문서: `README.md`
- 모듈 가이드: `MODULES.md`
- 이슈 트래커: (GitHub Issues 링크)
