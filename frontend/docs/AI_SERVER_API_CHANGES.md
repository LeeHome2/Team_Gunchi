# AI 서버 API 수정 사항

프론트엔드 관리자 페이지에서 호출하는 API 엔드포인트 목록입니다.
AI 서버 (`main.py`)에 아래 엔드포인트들을 추가해야 합니다.

---

## 1. 모델 다운로드

학습된 모델 파일을 다운로드합니다.

```
GET /api/mlops/models/{run_id}/download
```

**Parameters:**
- `run_id` (path): 모델의 run_id

**Response:**
- 성공: 모델 파일 (`.pkl`, `.joblib` 등) 바이너리 스트림
- Content-Type: `application/octet-stream`
- Content-Disposition: `attachment; filename="model_{run_id}.pkl"`

**예시 구현:**
```python
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
import os

router = APIRouter()

MODELS_DIR = "/path/to/models"

@router.get("/api/mlops/models/{run_id}/download")
async def download_model(run_id: str):
    # 모델 파일 경로 찾기
    model_path = os.path.join(MODELS_DIR, run_id, "model.pkl")

    if not os.path.exists(model_path):
        # joblib 형식도 확인
        model_path = os.path.join(MODELS_DIR, run_id, "model.joblib")

    if not os.path.exists(model_path):
        raise HTTPException(status_code=404, detail="모델 파일을 찾을 수 없습니다")

    filename = f"model_{run_id}.pkl"
    return FileResponse(
        model_path,
        media_type="application/octet-stream",
        filename=filename
    )
```

---

## 2. 모델 업로드

외부에서 학습된 모델 파일을 업로드하여 등록합니다.

```
POST /api/mlops/models/upload
```

**Request:**
- Content-Type: `multipart/form-data`
- Body:
  - `model_file`: 모델 파일 (필수)
  - `model_name`: 모델 이름/버전 (선택, 기본값: 파일명)
  - `algorithm`: 알고리즘 종류 (선택, 기본값: "Custom")

**Response:**
```json
{
  "success": true,
  "run_id": "uploaded_20240115_143022",
  "model_version": "my_model_v1",
  "message": "모델이 성공적으로 등록되었습니다"
}
```

**예시 구현:**
```python
from fastapi import UploadFile, File, Form
from datetime import datetime
import shutil
import json

@router.post("/api/mlops/models/upload")
async def upload_model(
    model_file: UploadFile = File(...),
    model_name: str = Form(None),
    algorithm: str = Form("Custom")
):
    # run_id 생성
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    run_id = f"uploaded_{timestamp}"

    # 저장 디렉토리 생성
    model_dir = os.path.join(MODELS_DIR, run_id)
    os.makedirs(model_dir, exist_ok=True)

    # 파일 저장
    file_ext = os.path.splitext(model_file.filename)[1]
    model_path = os.path.join(model_dir, f"model{file_ext}")

    with open(model_path, "wb") as f:
        shutil.copyfileobj(model_file.file, f)

    # experiments 목록에 추가 (experiments.json 또는 DB)
    experiment = {
        "run_id": run_id,
        "model_version": model_name or model_file.filename,
        "algorithm": algorithm,
        "trained_at": datetime.now().isoformat(),
        "source": "upload",
        "metrics": {}  # 업로드된 모델은 메트릭 없음
    }

    # experiments.json에 추가하는 로직...
    _add_experiment(experiment)

    return {
        "success": True,
        "run_id": run_id,
        "model_version": experiment["model_version"],
        "message": "모델이 성공적으로 등록되었습니다"
    }
```

---

## 3. 데이터셋 삭제

등록된 데이터셋을 삭제합니다.

```
DELETE /api/mlops/datasets/{dataset_id}
```

**Parameters:**
- `dataset_id` (path): 삭제할 데이터셋 ID

**Response:**
```json
{
  "success": true,
  "message": "데이터셋이 삭제되었습니다",
  "deleted_id": "dataset_20240115"
}
```

**예시 구현:**
```python
@router.delete("/api/mlops/datasets/{dataset_id}")
async def delete_dataset(dataset_id: str):
    # dataset_meta.json 로드
    meta_path = "configs/dataset_meta.json"

    with open(meta_path, "r") as f:
        meta = json.load(f)

    datasets = meta.get("datasets", [])

    # 해당 데이터셋 찾기
    target = None
    for ds in datasets:
        if ds.get("id") == dataset_id:
            target = ds
            break

    if not target:
        raise HTTPException(status_code=404, detail="데이터셋을 찾을 수 없습니다")

    # 목록에서 제거
    datasets = [ds for ds in datasets if ds.get("id") != dataset_id]
    meta["datasets"] = datasets

    # 저장
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)

    # (선택) 실제 파일도 삭제
    # if target.get("dxf_dir"):
    #     shutil.rmtree(target["dxf_dir"], ignore_errors=True)

    return {
        "success": True,
        "message": "데이터셋이 삭제되었습니다",
        "deleted_id": dataset_id
    }
```

---

## 4. 작업 목록 조회

진행 중인 작업과 최근 완료된 작업 목록을 반환합니다.

```
GET /api/mlops/jobs
```

**Response:**
```json
{
  "jobs": [
    {
      "job_id": "train_20240115_143022",
      "type": "train",
      "status": "running",
      "progress": 45,
      "started_at": "2024-01-15T14:30:22",
      "message": "Epoch 45/100..."
    },
    {
      "job_id": "build_20240115_140000",
      "type": "build",
      "status": "completed",
      "progress": 100,
      "started_at": "2024-01-15T14:00:00",
      "completed_at": "2024-01-15T14:25:00",
      "message": "98개 파일 처리 완료"
    }
  ]
}
```

**Job 객체 필드:**
| 필드 | 타입 | 설명 |
|------|------|------|
| job_id | string | 작업 ID |
| type | string | `train`, `build`, `preprocess` 중 하나 |
| status | string | `pending`, `running`, `completed`, `failed` |
| progress | number | 진행률 (0-100), 선택 |
| started_at | string | 시작 시간 (ISO 8601) |
| completed_at | string | 완료 시간, 선택 |
| message | string | 현재 상태 메시지, 선택 |

**예시 구현:**
```python
import subprocess
import psutil

# 메모리에 작업 상태 저장 (실제로는 Redis나 DB 사용 권장)
ACTIVE_JOBS = {}

@router.get("/api/mlops/jobs")
async def list_jobs():
    jobs = []

    for job_id, job_info in ACTIVE_JOBS.items():
        # 프로세스가 아직 실행 중인지 확인
        pid = job_info.get("pid")
        is_running = pid and psutil.pid_exists(pid)

        job = {
            "job_id": job_id,
            "type": job_info.get("type"),
            "status": "running" if is_running else job_info.get("status", "completed"),
            "progress": job_info.get("progress"),
            "started_at": job_info.get("started_at"),
            "completed_at": job_info.get("completed_at"),
            "message": job_info.get("message"),
        }
        jobs.append(job)

    # 최근 작업 순으로 정렬
    jobs.sort(key=lambda x: x.get("started_at", ""), reverse=True)

    return {"jobs": jobs[:20]}  # 최근 20개만


# 작업 시작 시 등록하는 함수
def register_job(job_id: str, job_type: str, pid: int):
    ACTIVE_JOBS[job_id] = {
        "type": job_type,
        "pid": pid,
        "status": "running",
        "progress": 0,
        "started_at": datetime.now().isoformat(),
        "message": "시작됨"
    }


# 작업 상태 업데이트 함수
def update_job_progress(job_id: str, progress: int, message: str = None):
    if job_id in ACTIVE_JOBS:
        ACTIVE_JOBS[job_id]["progress"] = progress
        if message:
            ACTIVE_JOBS[job_id]["message"] = message
```

---

## 5. 작업 로그 조회 (기존 API)

특정 작업의 로그를 조회합니다. (이미 구현되어 있을 수 있음)

```
GET /api/mlops/jobs/{job_id}/log
```

**Parameters:**
- `job_id` (path): 작업 ID
- `tail` (query, optional): 마지막 N줄만 반환 (기본값: 100)

**Response:**
```json
{
  "job_id": "train_20240115_143022",
  "tail": [
    "2024-01-15 14:30:22 - Starting training...",
    "2024-01-15 14:30:23 - Loading dataset...",
    "2024-01-15 14:30:25 - Epoch 1/100, loss: 0.523"
  ]
}
```

---

## 6. 데이터셋 목록 및 파이프라인 (필수 수정)

### 6-1. dataset_id 파라미터 지원

선택된 데이터셋에 대한 파이프라인 통계를 반환하도록 수정합니다.

```
GET /api/mlops/datasets
GET /api/mlops/datasets?dataset_id=xxx
```

**Parameters:**
- `dataset_id` (query, optional): 특정 데이터셋 ID. 지정하면 해당 데이터셋의 stages만 반환

**Response (dataset_id 없을 때):**
```json
{
  "stages": [
    {"label": "raw_dxf", "count": 150, "size_mb": 45, ...},
    {"label": "processed", "count": 120, "size_mb": 230, ...},
    ...
  ],
  "meta": {"datasets": [...]},
  "latest_split": {...}
}
```

**Response (dataset_id 있을 때):**
```json
{
  "stages": [
    {"label": "raw_dxf", "count": 30, "size_mb": 12, ...},  // 해당 데이터셋만
    {"label": "processed", "count": 25, "size_mb": 48, ...},
    ...
  ],
  "meta": {"datasets": [...]},
  "latest_split": {...}
}
```

**예시 구현:**
```python
@router.get("/api/mlops/datasets")
async def list_datasets(dataset_id: str = None):
    # 전체 데이터셋 목록
    all_datasets = load_dataset_meta()
    
    if dataset_id:
        # 특정 데이터셋의 경로 찾기
        target = next((ds for ds in all_datasets if ds.get("id") == dataset_id), None)
        if target and target.get("dxf_dir"):
            # 해당 데이터셋 디렉토리 기준으로 stages 계산
            stages = calculate_stages_for_dataset(target["dxf_dir"])
        else:
            stages = []
    else:
        # 전체 stages
        stages = calculate_all_stages()
    
    return {
        "stages": stages,
        "meta": {"datasets": all_datasets},
        "latest_split": get_latest_split()
    }

def calculate_stages_for_dataset(dxf_dir: str) -> list:
    """특정 데이터셋 디렉토리 기준 파이프라인 단계 계산"""
    dataset_name = os.path.basename(dxf_dir)
    
    return [
        {
            "label": "raw_dxf",
            "path": dxf_dir,
            "exists": os.path.exists(dxf_dir),
            "count": count_files(dxf_dir, "*.dxf"),
            "size_mb": get_dir_size_mb(dxf_dir),
            "last_modified": get_last_modified(dxf_dir)
        },
        {
            "label": "processed",
            "path": f"processed/{dataset_name}",
            "exists": os.path.exists(f"processed/{dataset_name}"),
            "count": count_files(f"processed/{dataset_name}", "*.png"),
            "size_mb": get_dir_size_mb(f"processed/{dataset_name}"),
            "last_modified": get_last_modified(f"processed/{dataset_name}")
        },
        {
            "label": "labeled",
            "path": f"labeled/{dataset_name}",
            "exists": os.path.exists(f"labeled/{dataset_name}"),
            "count": count_files(f"labeled/{dataset_name}", "*.csv"),
            "size_mb": get_dir_size_mb(f"labeled/{dataset_name}"),
            "last_modified": get_last_modified(f"labeled/{dataset_name}")
        }
    ]
```

### 6-2. 단일 파일 필터링 (권장)

현재 응답에 단일 파일 분류 기록(trabajo_final 등)도 포함되어 있습니다.
데이터셋만 반환하도록 필터링하거나, `source` 필드로 구분해주세요.

**방법 1: 서버에서 필터링**
```python
# 단일 파일 제외 (dxf_count > 1 또는 source == 'upload')
datasets = [
    ds for ds in all_datasets
    if ds.get("dxf_count", 0) > 1 or ds.get("source") == "upload"
]
```

**방법 2: source 필드 명확히 구분**
- 데이터셋 업로드: `source: "upload"`
- 단일 파일 분류: `source: "classify"` 또는 `source: "single"`
- 수동 등록: `source: "manual"`

---

## 요약

| 엔드포인트 | 메서드 | 설명 | 우선순위 |
|-----------|--------|------|---------|
| `/api/mlops/models/{run_id}/download` | GET | 모델 다운로드 | 높음 |
| `/api/mlops/models/upload` | POST | 모델 업로드 | 높음 |
| `/api/mlops/datasets/{dataset_id}` | DELETE | 데이터셋 삭제 | 중간 |
| `/api/mlops/datasets?dataset_id=xxx` | GET | 데이터셋별 파이프라인 | 높음 |
| `/api/mlops/jobs` | GET | 작업 목록 | 높음 |
| `/api/mlops/jobs/{job_id}/log` | GET | 작업 로그 | 기존 |

---

## 참고: 프론트엔드 호출 위치

- **모델 다운로드**: `app/admin/ai/page.tsx` - `handleDownloadModel()`
- **모델 업로드**: `components/admin/ModelUploadModal.tsx`
- **데이터셋 삭제**: `app/admin/ai/page.tsx` - `onDeleteDataset` prop
- **데이터셋별 파이프라인**: `components/admin/DatasetsPanel.tsx` - selectedId 파라미터
- **작업 목록**: `components/admin/JobProgressPanel.tsx`
