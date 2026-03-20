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

### 기본 워크플로우
1. "샘플 데이터로 테스트" 클릭
2. "3D 매스 생성" 클릭
3. "건물 위치로 이동" 클릭
4. 건물 드래그해서 이동
5. "배치 검토 실행" 클릭

### 지적도 & 건축선 워크플로우
1. "지역 선택" 버튼 클릭 후 지도에서 위치 클릭
2. 지적도 로드 후 "영역 선택" 버튼 클릭
3. 대지 블록 클릭하여 선택
4. "건축선 분석" 버튼으로 건축선 확인

### 프로젝트 저장/불러오기
1. 헤더의 "프로젝트 저장" 클릭
2. 프로젝트 이름 입력 (선택사항)
3. JSON 파일 다운로드
4. "불러오기"로 저장된 프로젝트 복원

---

## 4. 파일 구조 (핵심만)

```
frontend/
├── app/
│   ├── page.tsx          ← 메인 페이지 (헤더, 저장/불러오기)
│   └── api/              ← API 라우트 (지적도 WFS 프록시 등)
├── components/
│   ├── CesiumViewer.tsx  ← 3D 뷰어 (메인 컴포넌트)
│   ├── Sidebar.tsx       ← UI 컨트롤
│   └── ErrorBanner.tsx   ← 에러 표시
├── hooks/
│   ├── useCesiumViewer.ts     ← Cesium 초기화
│   ├── useCadastral.ts        ← 지적도 데이터
│   ├── useBlockSelection.ts   ← 블록 선택
│   ├── useBuildingLine.ts     ← 건축선 분석
│   ├── useOsmBuildings.ts     ← OSM 건물 숨김
│   └── useProjectPersistence.ts ← 프로젝트 저장/불러오기
├── store/
│   └── projectStore.ts   ← 전역 상태관리 (Zustand)
├── lib/
│   ├── api.ts            ← Backend API 호출
│   ├── geometry.ts       ← 기하학 유틸
│   ├── buildingLine.ts   ← 건축선 분석 로직
│   ├── setbackTable.ts   ← 이격거리 기준표
│   └── projectSerializer.ts ← 프로젝트 직렬화
└── types/
    ├── cesium.ts         ← Cesium 타입
    └── projectFile.ts    ← 프로젝트 파일 타입

backend/
├── main.py               ← API 엔드포인트
└── services/
    ├── dxf_parser.py     ← DXF 파싱
    ├── gltf_exporter.py  ← GLB 생성
    └── validation.py     ← 규정 검토
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
