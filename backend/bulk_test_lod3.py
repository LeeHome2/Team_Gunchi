#!/usr/bin/env python3
"""LOD3 Simple 벌크 테스트 스크립트.

uploads 폴더의 모든 DXF 파일에 대해 LOD3 Simple 생성을 테스트하고
성공률을 계산합니다.
"""

import os
import sys
import json
import time
from pathlib import Path
from typing import Dict, List, Any

# 프로젝트 루트를 path에 추가
sys.path.insert(0, str(Path(__file__).parent))

import ezdxf
from services.lod.lod3_simple import build_lod3_simple

UPLOADS_DIR = Path(__file__).parent / "uploads"
OUTPUT_DIR = Path(__file__).parent / "bulk_test_output"


def get_wall_layers_heuristic(dxf_path: str) -> List[str]:
    """DXF 파일에서 벽 레이어를 휴리스틱으로 찾기."""
    try:
        doc = ezdxf.readfile(dxf_path)
        msp = doc.modelspace()

        # 레이어별 엔티티 수 계산
        layer_counts = {}
        for ent in msp:
            layer = ent.dxf.layer
            layer_counts[layer] = layer_counts.get(layer, 0) + 1

        # 벽 관련 키워드
        wall_keywords = ['wall', 'muro', 'pared', 'mur', 'wand', 'a-wall', 'arch',
                        '벽', '외벽', '내벽', 'muros', 'paredes']

        wall_layers = []
        for layer in layer_counts:
            layer_lower = layer.lower()
            for kw in wall_keywords:
                if kw in layer_lower:
                    wall_layers.append(layer)
                    break

        # 벽 레이어를 못 찾으면 엔티티가 가장 많은 상위 3개 레이어 사용
        if not wall_layers:
            sorted_layers = sorted(layer_counts.items(), key=lambda x: -x[1])
            # 0 레이어 제외
            wall_layers = [l for l, c in sorted_layers[:5] if l != '0' and c > 10]

        return wall_layers[:3] if wall_layers else ['0']
    except Exception as e:
        return ['0']


def get_door_window_layers_heuristic(dxf_path: str) -> tuple:
    """DXF 파일에서 문/창문 레이어를 휴리스틱으로 찾기."""
    try:
        doc = ezdxf.readfile(dxf_path)
        msp = doc.modelspace()

        layer_counts = {}
        for ent in msp:
            layer = ent.dxf.layer
            layer_counts[layer] = layer_counts.get(layer, 0) + 1

        door_keywords = ['door', 'puerta', 'porte', 'tür', '문', 'puertas']
        window_keywords = ['window', 'ventana', 'fenêtre', 'fenster', '창문', '창', 'ventanas']

        door_layers = []
        window_layers = []

        for layer in layer_counts:
            layer_lower = layer.lower()
            for kw in door_keywords:
                if kw in layer_lower:
                    door_layers.append(layer)
                    break
            for kw in window_keywords:
                if kw in layer_lower:
                    window_layers.append(layer)
                    break

        return door_layers, window_layers
    except Exception:
        return [], []


def test_single_file(dxf_path: Path, output_dir: Path) -> Dict[str, Any]:
    """단일 DXF 파일 테스트."""
    result = {
        "file": dxf_path.name,
        "success": False,
        "error": None,
        "time_seconds": 0,
        "wall_layers": [],
        "door_layers": [],
        "window_layers": [],
        "mesh_stats": None
    }

    start_time = time.time()

    try:
        # 레이어 자동 감지
        wall_layers = get_wall_layers_heuristic(str(dxf_path))
        door_layers, window_layers = get_door_window_layers_heuristic(str(dxf_path))

        result["wall_layers"] = wall_layers
        result["door_layers"] = door_layers
        result["window_layers"] = window_layers

        # 출력 경로
        output_path = output_dir / f"{dxf_path.stem}.glb"

        # LOD3 Simple 생성
        lod_result = build_lod3_simple(
            str(dxf_path),
            wall_layers,
            door_layers,
            window_layers,
            height=3.0,
            output_path=str(output_path),
            include_roof=True
        )

        if lod_result and lod_result.get("success", True):
            result["success"] = True
            result["mesh_stats"] = lod_result.get("mesh_stats", {})
        else:
            result["error"] = "LOD3 생성 실패 (None 반환)"

    except Exception as e:
        result["error"] = str(e)

    result["time_seconds"] = round(time.time() - start_time, 2)
    return result


def run_bulk_test():
    """벌크 테스트 실행."""
    print("=" * 60)
    print("LOD3 Simple 벌크 테스트")
    print("=" * 60)

    # 출력 디렉토리 생성
    OUTPUT_DIR.mkdir(exist_ok=True)

    # DXF 파일 목록
    dxf_files = list(UPLOADS_DIR.glob("*.dxf"))
    total = len(dxf_files)

    print(f"총 {total}개 DXF 파일 테스트")
    print("-" * 60)

    results = []
    success_count = 0

    for i, dxf_path in enumerate(dxf_files, 1):
        print(f"[{i}/{total}] {dxf_path.name[:40]}...", end=" ", flush=True)

        result = test_single_file(dxf_path, OUTPUT_DIR)
        results.append(result)

        if result["success"]:
            success_count += 1
            stats = result.get("mesh_stats", {})
            print(f"OK ({result['time_seconds']}s, {stats.get('vertices', 0)} verts)")
        else:
            error_short = (result["error"] or "Unknown")[:50]
            print(f"FAIL: {error_short}")

    # 결과 요약
    print("=" * 60)
    print("테스트 결과 요약")
    print("=" * 60)

    success_rate = (success_count / total * 100) if total > 0 else 0
    print(f"성공: {success_count}/{total} ({success_rate:.1f}%)")

    # 실패 목록
    failures = [r for r in results if not r["success"]]
    if failures:
        print(f"\n실패 파일 ({len(failures)}개):")
        for f in failures[:20]:  # 최대 20개만 표시
            print(f"  - {f['file']}: {f['error'][:60] if f['error'] else 'Unknown'}")
        if len(failures) > 20:
            print(f"  ... 외 {len(failures) - 20}개")

    # 결과 저장
    report_path = OUTPUT_DIR / "bulk_test_report.json"
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump({
            "total": total,
            "success": success_count,
            "failure": total - success_count,
            "success_rate": success_rate,
            "results": results
        }, f, ensure_ascii=False, indent=2)

    print(f"\n상세 리포트: {report_path}")

    return success_rate >= 80


if __name__ == "__main__":
    success = run_bulk_test()
    sys.exit(0 if success else 1)
