# Building Cesium - AWS EC2 배포 가이드

본 문서는 Building Cesium 프로젝트를 팀원이 준비한 AWS EC2 인스턴스(`gachon-13-instance-server`)에 배포하는 절차를 설명합니다.

참고 문서:
- `cowork/서버사용(재가공).pptx` — AWS/EC2/RDS 세팅 정보
- `cowork/서버사용(AI).pptx` — 학과 AI 서버(ceprj2) 접속 정보

---

## 1. 사전 준비

### 1.1 필요한 것들
- EC2 SSH 키 파일 (`geonch_key.pem` 또는 팀원이 등록해준 공개키)
- 팀원으로부터 최신 EC2 퍼블릭 IP 확인 (재시작 시 변경됨)
- RDS DB 접속 정보 (이미 `.env.example`에 포함)
- Cesium Ion 토큰, V-World API 키 (프론트엔드용)

### 1.2 SSH 접속 설정

로컬 `~/.ssh/config` 파일에 추가:

```
Host geonch
    HostName [팀원에게 받은 EC2 퍼블릭 IP]
    User ec2-user
    IdentityFile ~/.ssh/geonch_key
```

접속 테스트:
```bash
ssh geonch
```

---

## 2. 백엔드 배포 (FastAPI + PostgreSQL)

### 2.1 코드 전송

로컬에서 EC2로 backend 폴더 업로드:
```bash
# 방법 1: scp
scp -r backend geonch:~/building_cesium/

# 방법 2: git (권장)
# EC2에 접속 후
ssh geonch
git clone [your-repo-url] ~/building_cesium
cd ~/building_cesium/backend
```

### 2.2 Python 환경 설정

EC2는 가상환경 사용 가능 (학과 서버와 달리 제약 없음):

```bash
cd ~/building_cesium/backend
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

설치에 오래 걸리는 패키지: `shapely`, `trimesh`, `pyproj`, `ezdxf`, `psycopg2-binary`

### 2.3 환경변수 설정

`.env` 파일 생성:
```bash
cp .env.example .env
nano .env
```

최소 필수 항목:
```env
DATABASE_URL=postgresql://masterusername:inbody&&7@gachon-13-db.cjysow2c4blk.ap-northeast-2.rds.amazonaws.com:5432/postgres
AI_SERVER_URL=http://ceprj2.gachon.ac.kr:65006
CORS_ORIGINS=http://[EC2-PUBLIC-IP]:3000
BACKEND_HOST=0.0.0.0
BACKEND_PORT=8000
```

### 2.4 DB 초기화 및 연결 확인

```bash
# 테이블 수동 생성 (선택 — 앱 시작 시 자동 생성됨)
python database/init_db.py

# 연결 테스트
python -c "from database.config import engine; print(engine.connect())"
```

### 2.5 서버 실행

**개발 모드** (SSH 세션 종료 시 서버도 종료):
```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

**프로덕션 모드** (백그라운드 실행):
```bash
# nohup 사용
nohup uvicorn main:app --host 0.0.0.0 --port 8000 > backend.log 2>&1 &

# 또는 tmux/screen 사용 (권장)
tmux new -s backend
uvicorn main:app --host 0.0.0.0 --port 8000
# Ctrl+B, D로 세션 분리
```

### 2.6 동작 확인

브라우저에서:
- `http://[EC2-IP]:8000/` — 루트 메시지 출력
- `http://[EC2-IP]:8000/docs` — FastAPI 자동 생성 API 문서 (Swagger UI)
- `http://[EC2-IP]:8000/health` — `{"status": "healthy"}` 반환

API 직접 테스트:
```bash
curl http://[EC2-IP]:8000/api/projects
```

---

## 3. 프론트엔드 배포 (Next.js)

### 3.1 Node.js 설치 (EC2에 최초 1회)

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 20
node -v && npm -v
```

### 3.2 코드 및 의존성 설치

```bash
cd ~/building_cesium/frontend
npm install
```

### 3.3 환경변수 설정

`.env.local` 파일 생성:
```bash
cp .env.local.example .env.local
nano .env.local
```

핵심 항목:
```env
NEXT_PUBLIC_API_URL=http://[EC2-PUBLIC-IP]:8000
NEXT_PUBLIC_CESIUM_TOKEN=[Cesium Ion 토큰]
VWORLD_API_KEY=[V-World API 키]
```

⚠️ **주의**: EC2 IP가 재시작마다 바뀌므로 `NEXT_PUBLIC_API_URL`도 매번 갱신 필요. 장기적으로는 Elastic IP 할당을 팀원과 논의.

### 3.4 프로덕션 빌드

```bash
npm run build
```

CesiumJS 번들링으로 빌드에 메모리가 많이 필요합니다. EC2 인스턴스가 작으면 다음을 사용:
```bash
NODE_OPTIONS="--max-old-space-size=4096" npm run build
```

### 3.5 서버 실행

**개발 모드**:
```bash
npm run dev
# 기본 포트 3000
```

**프로덕션 모드** (빌드 후):
```bash
# nohup
nohup npm start > frontend.log 2>&1 &

# tmux (권장)
tmux new -s frontend
npm start
```

기본 포트는 3000. 변경 필요시:
```bash
PORT=3001 npm start
```

### 3.6 EC2 보안그룹 확인

팀원에게 다음 포트가 인바운드 허용되어 있는지 확인 요청:
- `22` (SSH)
- `8000` (FastAPI)
- `3000` (Next.js)

---

## 4. AI 서버 연결 확인

### 4.1 학과 서버(ceprj2) 상태

현재 상황:
- 학과 서버는 SSH 접속 후 `python aiProject.py`로 실행하는 스크립트 기반
- **아직 HTTP 웹서버(FastAPI)로 올라가 있지 않음**
- 따라서 EC2 백엔드 → 학과 서버 직접 HTTP 호출은 불가능

### 4.2 팀원 확인 필요 사항
- AI 모델을 학과 서버에서 FastAPI 형태로 HTTP 엔드포인트로 띄울 수 있는지
- 포트 65006이 외부 공개인지, 학교 네트워크 내부만 가능한지
- 혹은 AWS EC2에 AI 모델을 옮겨 올리는 것이 가능한지

### 4.3 임시 동작

AI 서버가 없어도 현재 백엔드 `/api/classify`는 mock 데이터로 자동 fallback 합니다. 따라서 **AI 서버 연결 전에도 전체 파이프라인 시연 가능**합니다.

---

## 5. 배포 체크리스트

실제 배포 전 확인:

- [ ] EC2 인스턴스 실행 중, 퍼블릭 IP 확인
- [ ] SSH 접속 성공 (`ssh geonch`)
- [ ] RDS DB 접속 확인 (`psql $DATABASE_URL` 또는 `/health` 호출)
- [ ] 백엔드 `.env` 파일 생성 및 값 채움
- [ ] 프론트엔드 `.env.local` 파일 생성 및 `NEXT_PUBLIC_API_URL` 최신 IP로 갱신
- [ ] EC2 보안그룹 포트 22, 8000, 3000 인바운드 허용
- [ ] 백엔드 실행 후 `/health`, `/docs` 접근 가능 확인
- [ ] 프론트엔드 빌드 성공 (`npm run build`)
- [ ] 프론트엔드 → 백엔드 API 호출 정상 동작 (CORS 에러 없음)
- [ ] DXF 업로드 → 분석 모달 전체 흐름 동작
- [ ] AI 프록시 mock fallback 정상 동작

---

## 6. 자주 발생하는 문제

### 6.1 DB 연결 실패
```
psycopg2.OperationalError: could not connect to server
```
- RDS 보안그룹에서 EC2 IP 허용 여부 확인
- `DATABASE_URL`의 특수문자(`&&`) 인코딩 문제 → 필요시 `&&` → `%26%26`
- RDS 인스턴스가 stopped 상태가 아닌지 확인

### 6.2 CORS 에러
브라우저 콘솔:
```
Access to fetch at 'http://...' has been blocked by CORS policy
```
- `.env`의 `CORS_ORIGINS`에 프론트 URL 정확히 등록 (포트 포함)
- 와일드카드(`*`) 사용 시 `allow_credentials=False` 확인됨 (현재 main.py 자동 처리)

### 6.3 Cesium 3D 모델 로드 실패
- `NEXT_PUBLIC_CESIUM_TOKEN` 유효성 확인
- Next.js `next.config.js`의 CesiumJS copy-webpack-plugin 설정 확인
- 브라우저 네트워크 탭에서 Cesium Workers/Assets 404 여부 확인

### 6.4 IP 변경 시 대응
EC2 재시작 후 IP가 바뀌면:
1. 프론트엔드 `.env.local`의 `NEXT_PUBLIC_API_URL` 갱신
2. 프론트엔드 재빌드: `npm run build && npm start`
3. 백엔드 `CORS_ORIGINS`도 갱신 후 백엔드 재시작

Elastic IP를 할당하면 이 문제가 사라집니다 (팀원과 논의).

---

## 7. 다음 단계

배포 후 진행:
- AI 팀원과 분류 모델 HTTP 엔드포인트 연동
- 도메인 연결 (선택)
- HTTPS 인증서 (Let's Encrypt, 선택)
- 모니터링 (CloudWatch 또는 uptime-kuma)
- 자동 재시작 (systemd service 등록)
