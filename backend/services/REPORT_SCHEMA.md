# 결과 보고서 JSON 스키마 (Building Cesium)

`report_generator.js` 에 주입되는 JSON payload 구조.

백엔드(`POST /api/report`)는 현재 프로젝트 상태(site / building / validation /
pipeline) 를 아래 구조로 직렬화한 뒤 Node 스크립트로 넘겨 `.docx` 를 생성한다.

```jsonc
{
  "meta": {
    "generated_at": "2026-04-11",       // YYYY-MM-DD
    "author": "홍길동"                    // 로그인 사용자 이름 (선택)
  },

  "project": {
    "name": "청담동 단독주택",
    "address": "서울특별시 강남구 청담동 123-4",
    "longitude": 127.0486,
    "latitude": 37.5237,
    "zone_type": "제1종일반주거지역"
  },

  "site": {
    "area_m2": 482.35,
    "vertex_count": 6,
    "bounds": {
      "min_x": 0.0, "max_x": 32.1,
      "min_y": 0.0, "max_y": 18.4
    },
    "centroid_longitude": 127.04861,
    "centroid_latitude": 37.52372
  },

  "building": {
    "footprint_area_m2": 210.5,
    "height_m": 9.0,
    "floors": 3,
    "rotation_deg": 12.5,
    "position_longitude": 127.04861,
    "position_latitude": 37.52370,
    "mesh_stats": {
      "wall_meshes": 8,
      "vertices": 48,
      "faces": 28
    }
  },

  "validation": {
    "is_valid": false,
    "building_coverage": { "value": 43.6, "limit": 60.0, "status": "pass" },
    "setback":          { "min_distance_m": 0.8, "required_m": 1.0, "status": "fail" },
    "height":           { "value_m": 9.0, "limit_m": 12.0, "status": "pass" },
    "daylight":         { "value_m": 3.2, "required_m": 2.0, "status": "pass" },  // 선택
    "violations": [
      { "code": "SETBACK_VIOLATION",
        "message": "북측 이격거리 0.8m 로 기준(1.0m) 미달" }
    ]
  },

  "pipeline": {
    "parsed_entities": 1247,
    "classified_layers": 9,
    "classifier_model": "layer-classifier-v0 (mock)",
    "glb_size_bytes": 38420,
    "placement_applied": true,
    "validation_applied": true
  }
}
```

## 필드 규약

- `status` 값은 `"pass" | "fail" | "warning"` 중 하나 (대소문자 무관).
- `limit` / `required_*` 필드가 null 이면 "—" 로 표시된다.
- `validation.daylight` 는 선택 항목. 없으면 규정 테이블에서 행이 생략된다.
- `mesh_stats` 는 `/api/generate-mass` 응답 구조를 그대로 사용한다.
- `pipeline` 의 플래그는 단순 요약용이며, 세부 로그는 별도 API 로 노출한다.

## 호출 예 (백엔드)

```python
import json, subprocess, tempfile
from pathlib import Path

def generate_report(payload: dict, out_path: Path) -> Path:
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump(payload, f, ensure_ascii=False)
        tmp = f.name
    subprocess.run(
        ["node", "backend/services/report_generator.js", tmp, str(out_path)],
        check=True,
    )
    return out_path
```
