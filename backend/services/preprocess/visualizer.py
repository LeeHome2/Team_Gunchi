"""
DXF 처리 단계별 시각화 PNG 생성.

관리자 화면 (/admin/ai) 의 갤러리에서 사용.
호민님 핵심 요구사항: 각 단계 PNG 시각화로 검수 가능하게.

5종 PNG:
1. render_layer_overlay: 특정 레이어만 색칠 (벽/문/창 각각)
2. render_overlay_4color: 벽/문/창/other 4색 합성
3. render_floorplans_marked: 평면도 bbox 빨간 박스
4. render_openings_marked: 메인 출입구 + 주 창문면 마커
5. render_thumbnail: 관리자 갤러리 썸네일 (200x200)
"""
from __future__ import annotations

import io
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import ezdxf
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Circle, Rectangle
from matplotlib.lines import Line2D
from ezdxf.addons.drawing import Frontend, RenderContext
from ezdxf.addons.drawing.matplotlib import MatplotlibBackend

# ezdxf 설정 (있을 때만)
_RENDER_CONFIG = None
try:
    from ezdxf.addons.drawing.config import ColorPolicy, Configuration
    _RENDER_CONFIG = Configuration(color_policy=ColorPolicy.BLACK)
except Exception:
    pass


# ─── 색상 상수 ─────────────────────────────────────
COLOR_WALL = "#1a1a1a"       # 검정
COLOR_DOOR = "#ff8c00"       # 주황
COLOR_WINDOW = "#00b4ff"     # 하늘
COLOR_OTHER = "#aaaaaa"      # 회색
COLOR_BBOX = "#ff0000"       # 빨강 (평면도 박스)
COLOR_MAIN_ENTRANCE = "#ff0000"   # 빨강 (메인 출입구)
COLOR_PRIMARY_WINDOW = "#ffd700"  # 금색 (주 창문면)


def _load_doc_clean(dxf_path: Path) -> ezdxf.document.Drawing:
    """DXF 로드 + HATCH/SOLID 메모리 제거 (채움 패턴이 도면 덮는 문제 방지)."""
    doc = ezdxf.readfile(str(dxf_path))
    msp = doc.modelspace()
    for e in list(msp):
        if e.dxftype() in ("HATCH", "SOLID"):
            msp.delete_entity(e)
    return doc


def _get_doc_extents(doc: ezdxf.document.Drawing) -> Optional[Dict[str, float]]:
    """문서의 좌표 범위 반환."""
    from ezdxf import bbox as ezbbox
    msp = doc.modelspace()
    ext = ezbbox.extents(msp, fast=True)
    if ext is None or not ext.has_data:
        return None
    return {
        "min_x": float(ext.extmin.x),
        "min_y": float(ext.extmin.y),
        "max_x": float(ext.extmax.x),
        "max_y": float(ext.extmax.y),
    }


def _render_doc_to_ax(
    doc: ezdxf.document.Drawing,
    ax: plt.Axes,
    layer_colors: Optional[Dict[str, str]] = None,
    default_color: str = "#000000",
    alpha: float = 1.0,
) -> None:
    """ezdxf 문서를 matplotlib ax에 렌더링.

    layer_colors가 주어지면 레이어별로 색상 지정.
    """
    msp = doc.modelspace()
    ctx = RenderContext(doc)
    backend = MatplotlibBackend(ax)

    # 커스텀 색상 적용을 위해 레이어 색상 오버라이드
    if layer_colors:
        for layer_name, color in layer_colors.items():
            try:
                layer = doc.layers.get(layer_name)
                if layer:
                    # matplotlib 색상을 ezdxf ACI로 변환하기 어려우므로
                    # 렌더링 후 별도 처리 필요
                    pass
            except Exception:
                pass

    try:
        if _RENDER_CONFIG is not None:
            Frontend(ctx, backend, config=_RENDER_CONFIG).draw_layout(msp, finalize=True)
        else:
            Frontend(ctx, backend).draw_layout(msp, finalize=True)
    except Exception:
        pass  # 부분 실패 무시


def render_layer_overlay(
    dxf_path: Path,
    target_layers: List[str],
    color: str,
    output_path: Path,
    *,
    figsize: Tuple[int, int] = (12, 12),
    dpi: int = 100,
    other_alpha: float = 0.15,
) -> Path:
    """특정 레이어만 색칠. 나머지는 회색 옅게.

    벽만/문만/창문만 각각 한 번씩 호출.
    """
    doc = _load_doc_clean(dxf_path)
    msp = doc.modelspace()
    extents = _get_doc_extents(doc)

    if not extents:
        # 빈 도면이면 빈 이미지 생성
        fig, ax = plt.subplots(figsize=figsize, dpi=dpi)
        ax.text(0.5, 0.5, "Empty", ha="center", va="center", fontsize=20)
        ax.axis("off")
        output_path.parent.mkdir(parents=True, exist_ok=True)
        fig.savefig(str(output_path), dpi=dpi, bbox_inches="tight", pad_inches=0.1)
        plt.close(fig)
        return output_path

    fig, ax = plt.subplots(figsize=figsize, dpi=dpi)
    ax.set_aspect("equal")
    ax.axis("off")
    fig.patch.set_facecolor("white")
    ax.set_facecolor("white")

    # 범위 설정
    padding = 0.05
    width = extents["max_x"] - extents["min_x"]
    height = extents["max_y"] - extents["min_y"]
    ax.set_xlim(extents["min_x"] - width * padding, extents["max_x"] + width * padding)
    ax.set_ylim(extents["min_y"] - height * padding, extents["max_y"] + height * padding)

    target_set = set(layer.upper() for layer in target_layers)

    # 엔티티별로 그리기
    for entity in msp:
        try:
            layer_name = entity.dxf.layer.upper() if hasattr(entity.dxf, 'layer') else ""
            is_target = layer_name in target_set

            etype = entity.dxftype()
            line_color = color if is_target else COLOR_OTHER
            line_alpha = 1.0 if is_target else other_alpha
            line_width = 2.0 if is_target else 0.5

            if etype == "LINE":
                start = entity.dxf.start
                end = entity.dxf.end
                ax.plot([start.x, end.x], [start.y, end.y],
                       color=line_color, alpha=line_alpha, linewidth=line_width)

            elif etype == "LWPOLYLINE":
                points = list(entity.get_points(format="xy"))
                if points:
                    xs, ys = zip(*points)
                    if entity.closed:
                        xs = list(xs) + [xs[0]]
                        ys = list(ys) + [ys[0]]
                    ax.plot(xs, ys, color=line_color, alpha=line_alpha, linewidth=line_width)

            elif etype == "CIRCLE":
                circle = plt.Circle(
                    (entity.dxf.center.x, entity.dxf.center.y),
                    entity.dxf.radius,
                    fill=False, color=line_color, alpha=line_alpha, linewidth=line_width
                )
                ax.add_patch(circle)

            elif etype == "ARC":
                from matplotlib.patches import Arc
                arc = Arc(
                    (entity.dxf.center.x, entity.dxf.center.y),
                    entity.dxf.radius * 2, entity.dxf.radius * 2,
                    angle=0,
                    theta1=entity.dxf.start_angle,
                    theta2=entity.dxf.end_angle,
                    color=line_color, alpha=line_alpha, linewidth=line_width
                )
                ax.add_patch(arc)

        except Exception:
            continue  # 개별 엔티티 실패 무시

    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(str(output_path), dpi=dpi, bbox_inches="tight", pad_inches=0.1)
    plt.close(fig)
    return output_path


def render_overlay_4color(
    dxf_path: Path,
    layer_decisions: Dict[str, str],  # {layer_name: "wall"|"door"|"window"|"other"}
    output_path: Path,
    *,
    figsize: Tuple[int, int] = (12, 12),
    dpi: int = 100,
) -> Path:
    """벽/문/창/other 4색 합성 — AI 분류 검증용."""
    doc = _load_doc_clean(dxf_path)
    msp = doc.modelspace()
    extents = _get_doc_extents(doc)

    if not extents:
        fig, ax = plt.subplots(figsize=figsize, dpi=dpi)
        ax.text(0.5, 0.5, "Empty", ha="center", va="center", fontsize=20)
        ax.axis("off")
        output_path.parent.mkdir(parents=True, exist_ok=True)
        fig.savefig(str(output_path), dpi=dpi, bbox_inches="tight", pad_inches=0.1)
        plt.close(fig)
        return output_path

    # 클래스별 색상 매핑
    class_colors = {
        "wall": COLOR_WALL,
        "door": COLOR_DOOR,
        "window": COLOR_WINDOW,
        "other": COLOR_OTHER,
    }

    # layer_decisions를 대문자로 정규화
    layer_to_class = {k.upper(): v.lower() for k, v in layer_decisions.items()}

    fig, ax = plt.subplots(figsize=figsize, dpi=dpi)
    ax.set_aspect("equal")
    ax.axis("off")
    fig.patch.set_facecolor("white")
    ax.set_facecolor("white")

    padding = 0.05
    width = extents["max_x"] - extents["min_x"]
    height = extents["max_y"] - extents["min_y"]
    ax.set_xlim(extents["min_x"] - width * padding, extents["max_x"] + width * padding)
    ax.set_ylim(extents["min_y"] - height * padding, extents["max_y"] + height * padding)

    for entity in msp:
        try:
            layer_name = entity.dxf.layer.upper() if hasattr(entity.dxf, 'layer') else ""
            cls = layer_to_class.get(layer_name, "other")
            line_color = class_colors.get(cls, COLOR_OTHER)
            line_width = 2.0 if cls in ("wall", "door", "window") else 0.5
            line_alpha = 1.0 if cls in ("wall", "door", "window") else 0.3

            etype = entity.dxftype()

            if etype == "LINE":
                start = entity.dxf.start
                end = entity.dxf.end
                ax.plot([start.x, end.x], [start.y, end.y],
                       color=line_color, alpha=line_alpha, linewidth=line_width)

            elif etype == "LWPOLYLINE":
                points = list(entity.get_points(format="xy"))
                if points:
                    xs, ys = zip(*points)
                    if entity.closed:
                        xs = list(xs) + [xs[0]]
                        ys = list(ys) + [ys[0]]
                    ax.plot(xs, ys, color=line_color, alpha=line_alpha, linewidth=line_width)

            elif etype == "CIRCLE":
                circle = plt.Circle(
                    (entity.dxf.center.x, entity.dxf.center.y),
                    entity.dxf.radius,
                    fill=False, color=line_color, alpha=line_alpha, linewidth=line_width
                )
                ax.add_patch(circle)

            elif etype == "ARC":
                from matplotlib.patches import Arc
                arc = Arc(
                    (entity.dxf.center.x, entity.dxf.center.y),
                    entity.dxf.radius * 2, entity.dxf.radius * 2,
                    angle=0,
                    theta1=entity.dxf.start_angle,
                    theta2=entity.dxf.end_angle,
                    color=line_color, alpha=line_alpha, linewidth=line_width
                )
                ax.add_patch(arc)

        except Exception:
            continue

    # 범례 추가
    legend_elements = [
        Line2D([0], [0], color=COLOR_WALL, linewidth=2, label='Wall'),
        Line2D([0], [0], color=COLOR_DOOR, linewidth=2, label='Door'),
        Line2D([0], [0], color=COLOR_WINDOW, linewidth=2, label='Window'),
        Line2D([0], [0], color=COLOR_OTHER, linewidth=1, alpha=0.5, label='Other'),
    ]
    ax.legend(handles=legend_elements, loc='upper right', fontsize=10)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(str(output_path), dpi=dpi, bbox_inches="tight", pad_inches=0.1)
    plt.close(fig)
    return output_path


def _normalized_to_dxf(
    bbox_norm: Dict[str, float],
    extent: Dict[str, float],
) -> Dict[str, float]:
    """정규화 bbox (PNG 좌표 0~1) → DXF 좌표.

    PNG 는 y 가 위→아래 증가, DXF 는 아래→위 증가 → y 뒤집기.
    """
    w = extent["max_x"] - extent["min_x"]
    h = extent["max_y"] - extent["min_y"]
    return {
        "min_x": extent["min_x"] + bbox_norm["x_min"] * w,
        "max_x": extent["min_x"] + bbox_norm["x_max"] * w,
        "min_y": extent["min_y"] + (1 - bbox_norm["y_max"]) * h,
        "max_y": extent["min_y"] + (1 - bbox_norm["y_min"]) * h,
    }


def render_floorplans_marked(
    dxf_path: Path,
    floorplans: List[Dict],   # detect_floorplan 응답의 floorplans
    extent_dxf: Dict[str, float],
    output_path: Path,
    *,
    figsize: Tuple[int, int] = (12, 12),
    dpi: int = 100,
) -> Path:
    """원본 위에 평면도 bbox 빨간 박스 + label 오버레이."""
    doc = _load_doc_clean(dxf_path)
    msp = doc.modelspace()
    extents = _get_doc_extents(doc) or extent_dxf

    fig, ax = plt.subplots(figsize=figsize, dpi=dpi)
    ax.set_aspect("equal")
    ax.axis("off")
    fig.patch.set_facecolor("white")
    ax.set_facecolor("white")

    if extents:
        padding = 0.05
        width = extents["max_x"] - extents["min_x"]
        height = extents["max_y"] - extents["min_y"]
        ax.set_xlim(extents["min_x"] - width * padding, extents["max_x"] + width * padding)
        ax.set_ylim(extents["min_y"] - height * padding, extents["max_y"] + height * padding)

    # 원본 도면 그리기 (회색)
    for entity in msp:
        try:
            etype = entity.dxftype()
            if etype == "LINE":
                start = entity.dxf.start
                end = entity.dxf.end
                ax.plot([start.x, end.x], [start.y, end.y],
                       color=COLOR_OTHER, alpha=0.5, linewidth=0.5)
            elif etype == "LWPOLYLINE":
                points = list(entity.get_points(format="xy"))
                if points:
                    xs, ys = zip(*points)
                    if entity.closed:
                        xs = list(xs) + [xs[0]]
                        ys = list(ys) + [ys[0]]
                    ax.plot(xs, ys, color=COLOR_OTHER, alpha=0.5, linewidth=0.5)
            elif etype == "ARC":
                from matplotlib.patches import Arc
                arc = Arc(
                    (entity.dxf.center.x, entity.dxf.center.y),
                    entity.dxf.radius * 2, entity.dxf.radius * 2,
                    angle=0,
                    theta1=entity.dxf.start_angle,
                    theta2=entity.dxf.end_angle,
                    color=COLOR_OTHER, alpha=0.5, linewidth=0.5
                )
                ax.add_patch(arc)
        except Exception:
            continue

    # 평면도 bbox 그리기
    for i, fp in enumerate(floorplans):
        bbox_norm = fp.get("bbox", {})
        if not bbox_norm:
            continue

        # 정규화 좌표 → DXF 좌표 변환
        bbox_dxf = _normalized_to_dxf(bbox_norm, extent_dxf)

        x = bbox_dxf["min_x"]
        y = bbox_dxf["min_y"]
        w = bbox_dxf["max_x"] - bbox_dxf["min_x"]
        h = bbox_dxf["max_y"] - bbox_dxf["min_y"]

        rect = Rectangle(
            (x, y), w, h,
            linewidth=3, edgecolor=COLOR_BBOX, facecolor='none',
            linestyle='--'
        )
        ax.add_patch(rect)

        # 라벨 추가
        label = fp.get("label", f"fp_{i}")
        floor_index = fp.get("floor_index", -1)
        label_text = f"{label}" if floor_index < 0 else f"{label} (idx:{floor_index})"
        ax.text(
            x + w * 0.02, y + h * 0.98,
            label_text,
            fontsize=12, fontweight='bold',
            color='white', backgroundcolor=COLOR_BBOX,
            verticalalignment='top'
        )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(str(output_path), dpi=dpi, bbox_inches="tight", pad_inches=0.1)
    plt.close(fig)
    return output_path


def render_openings_marked(
    dxf_path: Path,
    main_entrance: Optional[Dict],   # {"center": [x,y], "width": ...}
    primary_window_face: Optional[Dict],  # {"midpoint": [x,y], "direction": [dx,dy], "length": ...}
    output_path: Path,
    *,
    figsize: Tuple[int, int] = (12, 12),
    dpi: int = 100,
) -> Path:
    """원본 위에 메인 출입구 ● + 주 창문면 ▬ 마커."""
    doc = _load_doc_clean(dxf_path)
    msp = doc.modelspace()
    extents = _get_doc_extents(doc)

    fig, ax = plt.subplots(figsize=figsize, dpi=dpi)
    ax.set_aspect("equal")
    ax.axis("off")
    fig.patch.set_facecolor("white")
    ax.set_facecolor("white")

    if extents:
        padding = 0.05
        width = extents["max_x"] - extents["min_x"]
        height = extents["max_y"] - extents["min_y"]
        ax.set_xlim(extents["min_x"] - width * padding, extents["max_x"] + width * padding)
        ax.set_ylim(extents["min_y"] - height * padding, extents["max_y"] + height * padding)

    # 원본 도면 그리기 (회색)
    for entity in msp:
        try:
            etype = entity.dxftype()
            if etype == "LINE":
                start = entity.dxf.start
                end = entity.dxf.end
                ax.plot([start.x, end.x], [start.y, end.y],
                       color=COLOR_OTHER, alpha=0.5, linewidth=0.5)
            elif etype == "LWPOLYLINE":
                points = list(entity.get_points(format="xy"))
                if points:
                    xs, ys = zip(*points)
                    if entity.closed:
                        xs = list(xs) + [xs[0]]
                        ys = list(ys) + [ys[0]]
                    ax.plot(xs, ys, color=COLOR_OTHER, alpha=0.5, linewidth=0.5)
            elif etype == "ARC":
                from matplotlib.patches import Arc
                arc = Arc(
                    (entity.dxf.center.x, entity.dxf.center.y),
                    entity.dxf.radius * 2, entity.dxf.radius * 2,
                    angle=0,
                    theta1=entity.dxf.start_angle,
                    theta2=entity.dxf.end_angle,
                    color=COLOR_OTHER, alpha=0.5, linewidth=0.5
                )
                ax.add_patch(arc)
        except Exception:
            continue

    # 메인 출입구 마커 (빨간 원)
    if main_entrance:
        center = main_entrance.get("center")
        if center and len(center) >= 2:
            cx, cy = center[0], center[1]
            entrance_width = main_entrance.get("width", 1.0)
            marker_size = max(entrance_width * 0.5, 0.3)

            circle = Circle(
                (cx, cy), marker_size,
                facecolor=COLOR_MAIN_ENTRANCE, edgecolor='white',
                linewidth=2, alpha=0.9, zorder=10
            )
            ax.add_patch(circle)

            ax.annotate(
                'Main\nEntrance',
                xy=(cx, cy), xytext=(cx, cy + marker_size * 3),
                fontsize=10, fontweight='bold', color=COLOR_MAIN_ENTRANCE,
                ha='center', va='bottom',
                arrowprops=dict(arrowstyle='->', color=COLOR_MAIN_ENTRANCE, lw=2)
            )

    # 주 창문면 마커 (금색 굵은 선)
    if primary_window_face:
        midpoint = primary_window_face.get("midpoint")
        direction = primary_window_face.get("direction")
        length = primary_window_face.get("length", 1.0)

        if midpoint and direction and len(midpoint) >= 2 and len(direction) >= 2:
            mx, my = midpoint[0], midpoint[1]
            dx, dy = direction[0], direction[1]

            # 방향 벡터 정규화
            import math
            mag = math.sqrt(dx*dx + dy*dy)
            if mag > 0:
                dx, dy = dx/mag, dy/mag

            # 선의 양 끝점 계산
            half_len = length / 2
            x1, y1 = mx - dx * half_len, my - dy * half_len
            x2, y2 = mx + dx * half_len, my + dy * half_len

            ax.plot(
                [x1, x2], [y1, y2],
                color=COLOR_PRIMARY_WINDOW, linewidth=6, alpha=0.9,
                solid_capstyle='round', zorder=9
            )

            ax.annotate(
                'Primary\nWindow Face',
                xy=(mx, my), xytext=(mx + length * 0.3, my + length * 0.3),
                fontsize=10, fontweight='bold', color=COLOR_PRIMARY_WINDOW,
                ha='left', va='bottom',
                arrowprops=dict(arrowstyle='->', color=COLOR_PRIMARY_WINDOW, lw=2)
            )

    # 마커가 없을 경우 안내 텍스트
    if not main_entrance and not primary_window_face:
        ax.text(
            0.5, 0.98, "No openings detected",
            transform=ax.transAxes,
            fontsize=12, color='gray',
            ha='center', va='top'
        )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(str(output_path), dpi=dpi, bbox_inches="tight", pad_inches=0.1)
    plt.close(fig)
    return output_path


def render_thumbnail(
    dxf_path: Path,
    output_path: Path,
    *,
    size: int = 200,
) -> Path:
    """관리자 갤러리 썸네일용 작은 PNG (200×200)."""
    doc = _load_doc_clean(dxf_path)
    msp = doc.modelspace()
    extents = _get_doc_extents(doc)

    # 작은 사이즈로 렌더링
    dpi = 72
    figsize = (size / dpi, size / dpi)

    fig, ax = plt.subplots(figsize=figsize, dpi=dpi)
    ax.set_aspect("equal")
    ax.axis("off")
    fig.patch.set_facecolor("white")
    ax.set_facecolor("white")

    if extents:
        padding = 0.02
        width = extents["max_x"] - extents["min_x"]
        height = extents["max_y"] - extents["min_y"]
        ax.set_xlim(extents["min_x"] - width * padding, extents["max_x"] + width * padding)
        ax.set_ylim(extents["min_y"] - height * padding, extents["max_y"] + height * padding)

    # 간소화된 렌더링 (LINE, LWPOLYLINE만)
    for entity in msp:
        try:
            etype = entity.dxftype()
            if etype == "LINE":
                start = entity.dxf.start
                end = entity.dxf.end
                ax.plot([start.x, end.x], [start.y, end.y],
                       color='#333333', linewidth=0.5)
            elif etype == "LWPOLYLINE":
                points = list(entity.get_points(format="xy"))
                if points:
                    xs, ys = zip(*points)
                    if entity.closed:
                        xs = list(xs) + [xs[0]]
                        ys = list(ys) + [ys[0]]
                    ax.plot(xs, ys, color='#333333', linewidth=0.5)
        except Exception:
            continue

    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(str(output_path), dpi=dpi, bbox_inches="tight", pad_inches=0.02)
    plt.close(fig)

    # PIL로 정확한 크기로 리사이즈
    try:
        from PIL import Image
        img = Image.open(output_path)
        img = img.resize((size, size), Image.Resampling.LANCZOS)
        img.save(output_path, optimize=True)
    except Exception:
        pass  # PIL 없으면 그대로 사용

    return output_path


def render_original(
    dxf_path: Path,
    output_path: Path,
    *,
    figsize: Tuple[int, int] = (12, 12),
    dpi: int = 100,
) -> Path:
    """원본 도면 렌더링 (검정색 선)."""
    doc = _load_doc_clean(dxf_path)
    msp = doc.modelspace()
    extents = _get_doc_extents(doc)

    fig, ax = plt.subplots(figsize=figsize, dpi=dpi)
    ax.set_aspect("equal")
    ax.axis("off")
    fig.patch.set_facecolor("white")
    ax.set_facecolor("white")

    if extents:
        padding = 0.05
        width = extents["max_x"] - extents["min_x"]
        height = extents["max_y"] - extents["min_y"]
        ax.set_xlim(extents["min_x"] - width * padding, extents["max_x"] + width * padding)
        ax.set_ylim(extents["min_y"] - height * padding, extents["max_y"] + height * padding)

    ctx = RenderContext(doc)
    backend = MatplotlibBackend(ax)

    try:
        if _RENDER_CONFIG is not None:
            Frontend(ctx, backend, config=_RENDER_CONFIG).draw_layout(msp, finalize=True)
        else:
            Frontend(ctx, backend).draw_layout(msp, finalize=True)
    except Exception:
        pass

    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(str(output_path), dpi=dpi, bbox_inches="tight", pad_inches=0.1)
    plt.close(fig)
    return output_path
