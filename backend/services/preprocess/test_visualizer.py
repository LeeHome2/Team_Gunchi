"""
Phase B Visualizer 단위 테스트.

테스트 항목:
- 5종 PNG 함수 모두 동작
- PNG 사이즈 합 < 5MB
"""
import pytest
from pathlib import Path
import tempfile
import shutil

# 테스트용 DXF 경로
SAMPLE_DXF = Path(__file__).parent.parent.parent.parent / "frontend" / "public" / "samples" / "arquitectura.dxf"


@pytest.fixture
def tmp_output_dir():
    """임시 출력 디렉토리."""
    tmp = Path(tempfile.mkdtemp(prefix="test_visualizer_"))
    yield tmp
    shutil.rmtree(tmp, ignore_errors=True)


def test_render_original(tmp_output_dir):
    """render_original 함수 테스트."""
    from services.preprocess.visualizer import render_original

    if not SAMPLE_DXF.exists():
        pytest.skip("샘플 DXF 없음")

    out = render_original(SAMPLE_DXF, tmp_output_dir / "original.png")
    assert out.exists()
    assert out.stat().st_size > 1000  # 최소 1KB


def test_render_thumbnail(tmp_output_dir):
    """render_thumbnail 함수 테스트."""
    from services.preprocess.visualizer import render_thumbnail

    if not SAMPLE_DXF.exists():
        pytest.skip("샘플 DXF 없음")

    out = render_thumbnail(SAMPLE_DXF, tmp_output_dir / "thumb.png", size=200)
    assert out.exists()
    assert out.stat().st_size > 500  # 최소 0.5KB
    assert out.stat().st_size < 100 * 1024  # 최대 100KB (썸네일이므로)


def test_render_overlay_4color(tmp_output_dir):
    """render_overlay_4color 함수 테스트."""
    from services.preprocess.visualizer import render_overlay_4color

    if not SAMPLE_DXF.exists():
        pytest.skip("샘플 DXF 없음")

    layer_decisions = {
        "S_WALL": "wall",
        "S_DOOR": "door",
        "S_WINDOW": "window",
    }
    out = render_overlay_4color(SAMPLE_DXF, layer_decisions, tmp_output_dir / "overlay.png")
    assert out.exists()
    assert out.stat().st_size > 1000


def test_render_layer_overlay(tmp_output_dir):
    """render_layer_overlay 함수 테스트."""
    from services.preprocess.visualizer import render_layer_overlay, COLOR_WALL

    if not SAMPLE_DXF.exists():
        pytest.skip("샘플 DXF 없음")

    out = render_layer_overlay(
        SAMPLE_DXF,
        ["S_WALL", "A_WALL"],
        COLOR_WALL,
        tmp_output_dir / "wall.png"
    )
    assert out.exists()
    assert out.stat().st_size > 1000


def test_render_floorplans_marked(tmp_output_dir):
    """render_floorplans_marked 함수 테스트."""
    from services.preprocess.visualizer import render_floorplans_marked

    if not SAMPLE_DXF.exists():
        pytest.skip("샘플 DXF 없음")

    floorplans = [
        {
            "label": "1F",
            "floor_index": 0,
            "bbox": {"x_min": 0.1, "y_min": 0.1, "x_max": 0.9, "y_max": 0.9}
        }
    ]
    extent_dxf = {"min_x": -25, "min_y": 260, "max_x": 25, "max_y": 290}

    out = render_floorplans_marked(
        SAMPLE_DXF, floorplans, extent_dxf,
        tmp_output_dir / "floorplans.png"
    )
    assert out.exists()
    assert out.stat().st_size > 1000


def test_render_openings_marked(tmp_output_dir):
    """render_openings_marked 함수 테스트."""
    from services.preprocess.visualizer import render_openings_marked

    if not SAMPLE_DXF.exists():
        pytest.skip("샘플 DXF 없음")

    main_entrance = {"center": [0.0, 275.0], "width": 1.2}
    primary_window = {"midpoint": [10.0, 280.0], "direction": [1.0, 0.0], "length": 5.0}

    out = render_openings_marked(
        SAMPLE_DXF, main_entrance, primary_window,
        tmp_output_dir / "openings.png"
    )
    assert out.exists()
    assert out.stat().st_size > 1000


def test_render_openings_marked_empty(tmp_output_dir):
    """render_openings_marked - 마커 없을 때 테스트."""
    from services.preprocess.visualizer import render_openings_marked

    if not SAMPLE_DXF.exists():
        pytest.skip("샘플 DXF 없음")

    out = render_openings_marked(
        SAMPLE_DXF, None, None,
        tmp_output_dir / "openings_empty.png"
    )
    assert out.exists()
    assert out.stat().st_size > 500


def test_total_size_under_5mb(tmp_output_dir):
    """5종 PNG 합 < 5MB 테스트."""
    from services.preprocess.visualizer import (
        render_original, render_thumbnail, render_overlay_4color,
        render_layer_overlay, render_floorplans_marked, render_openings_marked,
        COLOR_WALL
    )

    if not SAMPLE_DXF.exists():
        pytest.skip("샘플 DXF 없음")

    # 모든 PNG 생성
    render_original(SAMPLE_DXF, tmp_output_dir / "1.png")
    render_thumbnail(SAMPLE_DXF, tmp_output_dir / "2.png")
    render_overlay_4color(SAMPLE_DXF, {"S_WALL": "wall"}, tmp_output_dir / "3.png")
    render_layer_overlay(SAMPLE_DXF, ["S_WALL"], COLOR_WALL, tmp_output_dir / "4.png")
    render_floorplans_marked(
        SAMPLE_DXF,
        [{"label": "1F", "floor_index": 0, "bbox": {"x_min": 0.0, "y_min": 0.0, "x_max": 1.0, "y_max": 1.0}}],
        {"min_x": -25, "min_y": 260, "max_x": 25, "max_y": 290},
        tmp_output_dir / "5.png"
    )
    render_openings_marked(
        SAMPLE_DXF,
        {"center": [0.0, 275.0], "width": 1.0},
        {"midpoint": [10.0, 280.0], "direction": [1.0, 0.0], "length": 5.0},
        tmp_output_dir / "6.png"
    )

    # 총 사이즈 체크
    total = sum(f.stat().st_size for f in tmp_output_dir.glob("*.png"))
    assert total < 5 * 1024 * 1024, f"Total size {total / 1024 / 1024:.2f}MB exceeds 5MB"
