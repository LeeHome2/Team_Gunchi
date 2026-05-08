"""
LOD3 매스 생성 — 벽 + 슬래브 + 실제 개구부 (구멍).

개구부를 실제 구멍으로 뚫어서 벽 메쉬 생성.
3D Boolean 대신 벽을 섹션별로 분해하여 조립하는 방식.

섹션 분해 전략:
- 개구부가 없는 구간: 전체 높이로 압출
- 개구부 위: opening_top ~ wall_height 높이로 압출
- 개구부 아래: 0 ~ opening_bottom 높이로 압출 (창문만)
- 문: 바닥부터 시작하므로 아래 섹션 없음

실패 시 None 반환 → LOD2.5 또는 LOD1 fallback.
"""

import logging
from typing import List, Tuple, Optional, Dict, Any
import numpy as np
import trimesh
from shapely.geometry import Polygon as ShapelyPolygon, LineString

from .wall_types import WallSegment, WallLoop, CenterlineResult
from .openings import Opening, MappedOpening, extract_openings, map_openings_to_walls
from .lod2_builder import (
    _z_to_y_up,
    _compute_face_normals,
    _export_multi_primitive_glb,
    extract_footprint,
    create_slab_mesh,
    create_wall_mesh_from_loop,
    FLOOR_SLAB_THICKNESS,
    ROOF_SLAB_THICKNESS,
    FOUNDATION_DEPTH,
    WALL_COLOR,
    FLOOR_COLOR,
    ROOF_COLOR,
)

logger = logging.getLogger(__name__)


# ============= 상수 =============

# 개구부 기본 높이 (정보 없을 시)
DEFAULT_DOOR_HEIGHT = 2.1
DEFAULT_WINDOW_HEIGHT = 1.2

# 머티리얼 색상 (알아보기 쉽게)
DOOR_FRAME_COLOR = (255, 140, 0, 255)       # 주황색 (문)
WINDOW_FRAME_COLOR = (70, 130, 180, 255)    # 스틸블루 (창틀)
GLASS_COLOR = (135, 206, 250, 160)          # 하늘색 반투명 (유리)


# ============= 벽 섹션 분해 =============

def _create_wall_section(
    start_point: Tuple[float, float],
    end_point: Tuple[float, float],
    thickness: float,
    base_z: float,
    top_z: float
) -> Optional[trimesh.Trimesh]:
    """벽 섹션 메쉬 생성.

    Args:
        start_point: 시작점 (x, y)
        end_point: 끝점 (x, y)
        thickness: 벽 두께
        base_z: 섹션 하단 Z
        top_z: 섹션 상단 Z

    Returns:
        trimesh.Trimesh 또는 None
    """
    height = top_z - base_z
    if height <= 0.01:  # 1cm 미만은 무시
        return None

    try:
        line = LineString([start_point, end_point])
        if line.length < 0.01:  # 너무 짧은 선분
            return None

        poly = line.buffer(thickness / 2, cap_style=2)  # flat ends

        if poly.is_empty or not poly.is_valid:
            return None

        mesh = trimesh.creation.extrude_polygon(poly, height=height)
        mesh.vertices[:, 2] += base_z

        return mesh
    except Exception as e:
        logger.debug(f"벽 섹션 생성 실패: {e}")
        return None


def _get_segment_length(segment: WallSegment) -> float:
    """벽 세그먼트의 길이 계산."""
    dx = segment.end[0] - segment.start[0]
    dy = segment.end[1] - segment.start[1]
    return np.sqrt(dx*dx + dy*dy)


def _interpolate_point(
    segment: WallSegment,
    t: float
) -> Tuple[float, float]:
    """벽 세그먼트 위의 위치(t: 0~1)에 해당하는 점 계산."""
    return (
        segment.start[0] + t * (segment.end[0] - segment.start[0]),
        segment.start[1] + t * (segment.end[1] - segment.start[1])
    )


def create_wall_with_openings(
    segment: WallSegment,
    mapped_openings: List[MappedOpening],
    wall_height: float
) -> List[trimesh.Trimesh]:
    """개구부가 있는 벽 세그먼트를 섹션별로 분해하여 생성.

    Args:
        segment: 벽 세그먼트
        mapped_openings: 이 세그먼트에 매핑된 개구부들
        wall_height: 벽 높이

    Returns:
        메쉬 리스트 (섹션별)
    """
    meshes = []
    wall_length = _get_segment_length(segment)

    if wall_length < 0.1:
        return meshes

    # 개구부를 벽 위치 순으로 정렬
    sorted_openings = sorted(mapped_openings, key=lambda mo: mo.wall_position)

    # 벽 방향 벡터 (정규화)
    wall_dir = np.array([
        segment.end[0] - segment.start[0],
        segment.end[1] - segment.start[1]
    ]) / wall_length

    # 이전 섹션 끝 위치 (0~1)
    prev_t = 0.0

    for mo in sorted_openings:
        opening = mo.opening

        # 개구부의 벽 위 범위 계산 (t 값으로)
        half_width_t = (opening.width / 2) / wall_length
        opening_start_t = max(0.0, mo.wall_position - half_width_t)
        opening_end_t = min(1.0, mo.wall_position + half_width_t)

        # 1. 개구부 왼쪽 섹션 (전체 높이)
        if opening_start_t > prev_t + 0.001:  # 최소 간격 체크
            start_pt = _interpolate_point(segment, prev_t)
            end_pt = _interpolate_point(segment, opening_start_t)
            mesh = _create_wall_section(
                start_pt, end_pt,
                segment.thickness,
                base_z=0.0,
                top_z=wall_height
            )
            if mesh:
                meshes.append(mesh)

        # 개구부 높이 정보
        opening_height = opening.height or DEFAULT_DOOR_HEIGHT
        opening_bottom = opening.bottom_z
        opening_top = opening_bottom + opening_height

        # 개구부 영역의 좌우 끝점
        opening_left_pt = _interpolate_point(segment, opening_start_t)
        opening_right_pt = _interpolate_point(segment, opening_end_t)

        # 2. 개구부 아래 섹션 (창문인 경우만)
        if opening.opening_type == 'window' and opening_bottom > 0.05:
            mesh = _create_wall_section(
                opening_left_pt, opening_right_pt,
                segment.thickness,
                base_z=0.0,
                top_z=opening_bottom
            )
            if mesh:
                meshes.append(mesh)

        # 3. 개구부 위 섹션
        if opening_top < wall_height - 0.05:
            mesh = _create_wall_section(
                opening_left_pt, opening_right_pt,
                segment.thickness,
                base_z=opening_top,
                top_z=wall_height
            )
            if mesh:
                meshes.append(mesh)

        prev_t = opening_end_t

    # 4. 마지막 개구부 오른쪽 섹션 (전체 높이)
    if prev_t < 1.0 - 0.001:
        start_pt = _interpolate_point(segment, prev_t)
        end_pt = segment.end
        mesh = _create_wall_section(
            start_pt, end_pt,
            segment.thickness,
            base_z=0.0,
            top_z=wall_height
        )
        if mesh:
            meshes.append(mesh)

    return meshes


# ============= 개구부 프레임 및 유리 생성 =============

def create_door_panel(
    mapped_opening: MappedOpening,
    wall_height: float
) -> Optional[trimesh.Trimesh]:
    """문 패널 메쉬 생성 (얇은 박스).

    문은 열려있는 상태로 표현하지 않고,
    프레임 영역을 표시하는 얇은 패널로 생성.
    """
    opening = mapped_opening.opening
    segment = mapped_opening.wall_segment

    # 벽 방향 벡터
    wall_length = _get_segment_length(segment)
    if wall_length < 0.1:
        return None

    wall_dir = np.array([
        segment.end[0] - segment.start[0],
        segment.end[1] - segment.start[1]
    ]) / wall_length

    # 벽 법선 (외부 방향)
    wall_normal = np.array([-wall_dir[1], wall_dir[0]])

    # 개구부 중심
    center = _interpolate_point(segment, mapped_opening.wall_position)

    # 패널 치수
    panel_width = opening.width
    panel_height = opening.height or DEFAULT_DOOR_HEIGHT
    panel_thickness = 0.05  # 5cm 두께

    try:
        # trimesh 박스 생성 (원점 중심)
        box = trimesh.creation.box(extents=[panel_width, panel_thickness, panel_height])

        # 회전: 벽 방향에 맞춤
        angle = np.arctan2(wall_dir[1], wall_dir[0])
        rotation = trimesh.transformations.rotation_matrix(angle, [0, 0, 1])
        box.apply_transform(rotation)

        # 이동: 개구부 중심으로
        center_z = opening.bottom_z + panel_height / 2
        translation = trimesh.transformations.translation_matrix([center[0], center[1], center_z])
        box.apply_transform(translation)

        return box
    except Exception as e:
        logger.debug(f"문 패널 생성 실패: {e}")
        return None


def create_window_frame_and_glass(
    mapped_opening: MappedOpening,
    wall_height: float
) -> Tuple[Optional[trimesh.Trimesh], Optional[trimesh.Trimesh]]:
    """창문 프레임과 유리 메쉬 생성.

    Returns:
        (frame_mesh, glass_mesh) 튜플
    """
    opening = mapped_opening.opening
    segment = mapped_opening.wall_segment

    # 벽 방향 벡터
    wall_length = _get_segment_length(segment)
    if wall_length < 0.1:
        return None, None

    wall_dir = np.array([
        segment.end[0] - segment.start[0],
        segment.end[1] - segment.start[1]
    ]) / wall_length

    # 개구부 중심
    center = _interpolate_point(segment, mapped_opening.wall_position)

    # 창문 치수
    window_width = opening.width
    window_height = opening.height or DEFAULT_WINDOW_HEIGHT
    frame_thickness = 0.03  # 3cm 프레임 폭
    frame_depth = max(segment.thickness / 2, 0.05)  # 프레임 깊이

    bottom_z = opening.bottom_z
    center_z = bottom_z + window_height / 2

    # 회전 행렬 (벽 방향에 맞춤)
    angle = np.arctan2(wall_dir[1], wall_dir[0])

    def create_box(width, depth, height, offset_x=0, offset_z=0):
        """박스 생성 및 변환"""
        try:
            box = trimesh.creation.box(extents=[width, depth, height])
            # 회전
            rotation = trimesh.transformations.rotation_matrix(angle, [0, 0, 1])
            box.apply_transform(rotation)
            # 이동 (offset_x는 로컬 X 방향)
            dx = offset_x * wall_dir[0]
            dy = offset_x * wall_dir[1]
            translation = trimesh.transformations.translation_matrix([
                center[0] + dx,
                center[1] + dy,
                center_z + offset_z
            ])
            box.apply_transform(translation)
            return box
        except Exception as e:
            logger.debug(f"박스 생성 실패: {e}")
            return None

    frame_meshes = []

    # 하단 프레임
    bottom_frame = create_box(
        window_width, frame_depth, frame_thickness,
        offset_x=0,
        offset_z=-window_height/2 + frame_thickness/2
    )
    if bottom_frame:
        frame_meshes.append(bottom_frame)

    # 상단 프레임
    top_frame = create_box(
        window_width, frame_depth, frame_thickness,
        offset_x=0,
        offset_z=window_height/2 - frame_thickness/2
    )
    if top_frame:
        frame_meshes.append(top_frame)

    # 좌측 프레임
    left_frame = create_box(
        frame_thickness, frame_depth, window_height - 2*frame_thickness,
        offset_x=-window_width/2 + frame_thickness/2,
        offset_z=0
    )
    if left_frame:
        frame_meshes.append(left_frame)

    # 우측 프레임
    right_frame = create_box(
        frame_thickness, frame_depth, window_height - 2*frame_thickness,
        offset_x=window_width/2 - frame_thickness/2,
        offset_z=0
    )
    if right_frame:
        frame_meshes.append(right_frame)

    # 프레임 병합
    frame_mesh = None
    if frame_meshes:
        try:
            frame_mesh = trimesh.util.concatenate(frame_meshes)
        except Exception as e:
            logger.debug(f"프레임 병합 실패: {e}")

    # 유리 (얇은 박스)
    glass_width = window_width - 2 * frame_thickness
    glass_height = window_height - 2 * frame_thickness
    glass_depth = 0.01  # 유리 두께

    glass_mesh = create_box(glass_width, glass_depth, glass_height, offset_x=0, offset_z=0)

    return frame_mesh, glass_mesh


# ============= LOD3 빌드 메인 함수 =============

def build_lod3(
    centerline_result: CenterlineResult,
    dxf_path: str,
    door_layers: List[str],
    window_layers: List[str],
    height: float = 4.0,
    output_path: str = "building_lod3.glb"
) -> Optional[Dict[str, Any]]:
    """LOD3 매스 생성 (벽 + 슬래브 + 실제 구멍 + 창틀/유리).

    Args:
        centerline_result: Phase 1 centerline 재구성 결과
        dxf_path: DXF 파일 경로 (개구부 추출용)
        door_layers: 문 레이어 이름 목록
        window_layers: 창문 레이어 이름 목록
        height: 건물 높이 (m)
        output_path: 출력 GLB 경로

    Returns:
        성공 시 {"success": True, "mesh_stats": {...}, "steps": [...]}
        실패 시 None → LOD2.5 또는 LOD2 fallback
    """
    if not centerline_result.is_usable:
        logger.warning(f"Centerline 성공률 {centerline_result.success_rate:.1%} < 80%, fallback 권장")
        return None

    steps = []
    meshes_data = []  # [(vertices, faces, color, name), ...]

    # 1. Footprint 추출
    footprint = extract_footprint(centerline_result)
    if footprint is None:
        logger.warning("Footprint 추출 실패")
        return None
    steps.append({"label": "Footprint 추출", "detail": f"면적: {footprint.area:.2f}㎡"})

    # 2. 개구부 추출 및 매핑
    openings = extract_openings(dxf_path, door_layers, window_layers)
    mapped_openings = []
    if openings:
        mapped_openings = map_openings_to_walls(openings, centerline_result)
    steps.append({"label": "개구부 추출", "detail": f"문 {sum(1 for o in openings if o.opening_type == 'door')}개, 창문 {sum(1 for o in openings if o.opening_type == 'window')}개"})

    # 3. 세그먼트별 개구부 그룹화
    segment_openings: Dict[int, List[MappedOpening]] = {}
    for mo in mapped_openings:
        # 세그먼트 ID를 (start, end) 튜플로 생성
        seg_key = id(mo.wall_segment)
        if seg_key not in segment_openings:
            segment_openings[seg_key] = []
        segment_openings[seg_key].append(mo)

    # 4. 벽 메쉬 생성 (개구부가 있는 벽은 섹션 분해)
    wall_meshes = []

    for i, segment in enumerate(centerline_result.segments):
        seg_key = id(segment)
        seg_mapped = segment_openings.get(seg_key, [])

        if seg_mapped:
            # 개구부가 있는 벽: 섹션 분해
            section_meshes = create_wall_with_openings(segment, seg_mapped, height)
            wall_meshes.extend(section_meshes)
        else:
            # 개구부 없는 벽: 전체 높이로 생성
            from .lod2_builder import create_wall_mesh_from_segment
            mesh = create_wall_mesh_from_segment(segment, height, base_z=0)
            if mesh:
                wall_meshes.append(mesh)

    # 루프에서 생성 (개구부 처리 없이)
    for loop in centerline_result.loops:
        mesh = create_wall_mesh_from_loop(loop, height, base_z=0)
        if mesh:
            wall_meshes.append(mesh)

    if not wall_meshes:
        logger.warning("벽 메쉬 생성 실패")
        return None

    # 벽 메쉬 병합
    combined_walls = trimesh.util.concatenate(wall_meshes)
    meshes_data.append((
        np.array(combined_walls.vertices),
        np.array(combined_walls.faces),
        WALL_COLOR,
        "walls"
    ))
    steps.append({"label": "벽 메쉬 생성", "detail": f"{len(wall_meshes)}개 섹션"})

    # 5. 바닥 슬래브
    floor_mesh = create_slab_mesh(footprint, FLOOR_SLAB_THICKNESS, base_z=FOUNDATION_DEPTH)
    if floor_mesh:
        meshes_data.append((
            np.array(floor_mesh.vertices),
            np.array(floor_mesh.faces),
            FLOOR_COLOR,
            "floor_slab"
        ))
        steps.append({"label": "바닥 슬래브 생성", "detail": f"두께: {FLOOR_SLAB_THICKNESS}m"})

    # 6. 지붕 슬래브
    roof_mesh = create_slab_mesh(footprint, ROOF_SLAB_THICKNESS, base_z=height)
    if roof_mesh:
        meshes_data.append((
            np.array(roof_mesh.vertices),
            np.array(roof_mesh.faces),
            ROOF_COLOR,
            "roof_slab"
        ))
        steps.append({"label": "지붕 슬래브 생성", "detail": f"두께: {ROOF_SLAB_THICKNESS}m"})

    # 7. 창틀 및 유리 생성
    frame_meshes = []
    glass_meshes = []
    door_meshes = []

    for mo in mapped_openings:
        if mo.opening.opening_type == 'door':
            panel = create_door_panel(mo, height)
            if panel:
                door_meshes.append(panel)
        else:
            frame, glass = create_window_frame_and_glass(mo, height)
            if frame:
                frame_meshes.append(frame)
            if glass:
                glass_meshes.append(glass)

    # 문 패널
    if door_meshes:
        combined_doors = trimesh.util.concatenate(door_meshes)
        meshes_data.append((
            np.array(combined_doors.vertices),
            np.array(combined_doors.faces),
            DOOR_FRAME_COLOR,
            "door_panels"
        ))
        steps.append({"label": "문 패널", "detail": f"{len(door_meshes)}개"})

    # 창틀
    if frame_meshes:
        combined_frames = trimesh.util.concatenate(frame_meshes)
        meshes_data.append((
            np.array(combined_frames.vertices),
            np.array(combined_frames.faces),
            WINDOW_FRAME_COLOR,
            "window_frames"
        ))
        steps.append({"label": "창틀", "detail": f"{len(frame_meshes)}개"})

    # 유리
    if glass_meshes:
        combined_glass = trimesh.util.concatenate(glass_meshes)
        meshes_data.append((
            np.array(combined_glass.vertices),
            np.array(combined_glass.faces),
            GLASS_COLOR,
            "window_glass"
        ))
        steps.append({"label": "유리", "detail": f"{len(glass_meshes)}개"})

    # 8. GLB 조립
    try:
        mesh_stats = _export_multi_primitive_glb(meshes_data, output_path)
        steps.append({"label": "GLB 파일 저장", "detail": f"{mesh_stats['primitives']}개 primitive"})

        logger.info(f"LOD3 매스 생성 완료: {mesh_stats['vertices']} vertices, {mesh_stats['faces']} faces")

        return {
            "success": True,
            "lod": 3,
            "mesh_stats": mesh_stats,
            "steps": steps,
            "footprint_area": footprint.area,
            "openings_count": len(mapped_openings),
        }
    except Exception as e:
        logger.error(f"GLB 생성 실패: {e}")
        return None
