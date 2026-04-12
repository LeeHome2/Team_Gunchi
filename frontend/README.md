# AI 건축물 배치 시스템

Cesium 3D 지도 기반의 건축물 배치 및 검토 시스템

## 개요

이 시스템은 3D 지도 위에서 건축물 모델을 배치하고, 지적도를 확인하며, 기존 건물을 관리할 수 있는 웹 애플리케이션입니다.

## 기술 스택

- **Frontend**: Next.js 14, React, TypeScript
- **3D Engine**: CesiumJS
- **State Management**: Zustand
- **Styling**: Tailwind CSS
- **Map Data**: Google Maps, Vworld WMS (지적도)
- **3D Buildings**: OpenStreetMap Buildings

---

## 현재 기능

### 1. 3D 지도 뷰어
- Google Maps 기반 위성/지도 타일
- OSM 3D 건물 자동 로드
- 지형(Terrain) 표시
- 일조 시뮬레이션 (날짜/시간 조절)

**카메라 조작:**
- 좌클릭 드래그: 회전 (Orbit)
- 우클릭 드래그: 시점 조절 (Tilt)
- 마우스 휠: 줌

### 2. 주소 검색
- 헤더의 검색창에서 주소 검색
- Nominatim API 사용 (OpenStreetMap)
- 검색 결과 위치로 카메라 이동

### 3. 작업 영역 선택
- "영역 선택" 버튼 클릭 후 지도에서 위치 클릭
- 선택한 위치의 주소 자동 표시 (역지오코딩)
- 모델 로드 시 해당 위치에 배치

### 4. 지적도 표시
- "지적도" 버튼으로 토글
- Vworld WMS API 사용
- 선택 영역 주변 약 200m 범위 로드
- Next.js API 프록시로 CORS 해결

### 5. 3D 모델 로드
- 사이드바에서 샘플 모델 선택
- GLB 형식 지원
- 작업 영역 또는 기본 위치에 로드

**모델 조작:**
- 좌클릭 드래그: 위치 이동
- 휠클릭 드래그: 회전 (마우스 방향으로)
- 사이드바 슬라이더: 높이/회전 미세 조절

### 6. 기존 건물 삭제
- "건물 삭제" 버튼으로 선택 모드 진입
- OSM 건물 클릭하여 선택
- "이 건물 숨기기"로 건물 제거
- 숨긴 건물 목록에서 개별/전체 복원 가능

### 7. 뷰포트 상태 유지
- "새로고침" 버튼으로 뷰포트만 리셋
- 모델, 카메라 위치, 시간 설정 유지
- localStorage에 상태 저장

---

## 파일 구조

```
frontend/
├── app/
│   ├── page.tsx              # 메인 페이지
│   ├── layout.tsx            # 레이아웃
│   ├── globals.css           # 전역 스타일
│   └── api/
│       └── cadastral/
│           ├── route.ts      # 지적도 프록시 API
│           └── capabilities/
│               └── route.ts  # WMS 레이어 조회 API
├── components/
│   ├── CesiumViewer.tsx      # 3D 뷰어 컴포넌트
│   └── Sidebar.tsx           # 사이드바 컴포넌트
├── store/
│   └── projectStore.ts       # Zustand 상태 관리
└── public/
    └── models/
        └── sample_house.glb  # 샘플 3D 모델
```

---

## 환경 변수

```env
NEXT_PUBLIC_CESIUM_TOKEN=your_cesium_ion_token
```

## API 키

- **Vworld API**: `2D8CA368-665E-34A7-8CC3-CABBDAB8DAC0` (app/api/cadastral/route.ts에 저장)

---

## 로드맵

### Phase 1: 기본 기능 (완료)
- [x] Cesium 3D 뷰어 통합
- [x] Google Maps 베이스맵
- [x] OSM 3D 건물 로드
- [x] 주소 검색
- [x] 작업 영역 선택
- [x] 지적도 WMS 연동
- [x] 3D 모델 로드
- [x] 모델 드래그/회전
- [x] 기존 건물 선택 삭제
- [x] 뷰포트 상태 저장/복원

### Phase 2: 건축 규정 검토 (예정)
- [ ] 대지 경계선 입력/편집
- [ ] 건폐율 자동 계산
- [ ] 용적률 자동 계산
- [ ] 인접 대지 경계선 이격거리 검토
- [ ] 도로 사선제한 검토
- [ ] 일조권 사선제한 검토
- [ ] 검토 결과 리포트 생성

### Phase 3: 고급 기능 (예정)
- [ ] 다중 건물 배치
- [ ] 건물 파라메트릭 편집 (층수, 면적 등)
- [ ] 사용자 모델 업로드 (GLB/glTF)
- [ ] 프로젝트 저장/불러오기
- [ ] 프로젝트 내보내기 (이미지, PDF)

### Phase 4: AI 기능 (예정)
- [ ] AI 기반 최적 배치 추천
- [ ] 규정 위반 자동 감지 및 수정 제안
- [ ] 자연어 명령으로 건물 조작
- [ ] 유사 프로젝트 분석 및 추천

### Phase 5: 협업 기능 (예정)
- [ ] 사용자 인증
- [ ] 프로젝트 공유
- [ ] 실시간 협업 편집
- [ ] 코멘트 및 마크업

---

## 알려진 이슈

1. **모델 스케일**: 현재 모델 스케일이 5.0으로 고정되어 있음
2. **지적도 범위**: 선택 영역 주변 약 200m만 로드됨
3. **OSM 건물 정보**: 일부 건물은 이름 정보가 없음

---

## 실행 방법

```bash
# 의존성 설치
npm install

# 개발 서버 실행
npm run dev

# 빌드
npm run build

# 프로덕션 실행
npm start
```

접속: http://localhost:3000

---

## 라이선스

Private Project
