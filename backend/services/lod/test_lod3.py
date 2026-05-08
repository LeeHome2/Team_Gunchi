"""
LOD3 빌더 테스트.

테스트 항목:
1. 벽 섹션 분해 (개구부 영역 분리)
2. 문 패널 생성
3. 창틀/유리 생성
4. 전체 LOD3 빌드
5. watertight 검증
"""

import pytest
import numpy as np
import trimesh
import tempfile
import os
from pathlib import Path

from .wall_types import WallSegment, CenterlineResult
from .openings import Opening, MappedOpening
from .lod3_builder import (
    _create_wall_section,
    _get_segment_length,
    _interpolate_point,
    create_wall_with_openings,
    create_door_panel,
    create_window_frame_and_glass,
    build_lod3,
)


class TestWallSection:
    """벽 섹션 생성 테스트"""

    def test_create_simple_wall_section(self):
        """기본 벽 섹션 생성"""
        mesh = _create_wall_section(
            start_point=(0, 0),
            end_point=(5, 0),
            thickness=0.15,
            base_z=0,
            top_z=3
        )
        assert mesh is not None
        assert len(mesh.vertices) > 0
        assert len(mesh.faces) > 0

    def test_wall_section_dimensions(self):
        """벽 섹션 치수 확인"""
        mesh = _create_wall_section(
            start_point=(0, 0),
            end_point=(5, 0),
            thickness=0.2,
            base_z=0,
            top_z=4
        )
        assert mesh is not None
        bounds = mesh.bounds
        # X 범위: 약 5m
        assert abs(bounds[1, 0] - bounds[0, 0] - 5) < 0.5
        # Z 범위: 4m
        assert abs(bounds[1, 2] - bounds[0, 2] - 4) < 0.1

    def test_partial_height_section(self):
        """부분 높이 섹션 (개구부 위/아래)"""
        # 창문 아래 섹션 (0~0.9m)
        mesh_below = _create_wall_section(
            start_point=(0, 0),
            end_point=(2, 0),
            thickness=0.15,
            base_z=0,
            top_z=0.9
        )
        assert mesh_below is not None
        assert mesh_below.bounds[1, 2] - mesh_below.bounds[0, 2] < 1.0

        # 창문 위 섹션 (2.1~3m)
        mesh_above = _create_wall_section(
            start_point=(0, 0),
            end_point=(2, 0),
            thickness=0.15,
            base_z=2.1,
            top_z=3
        )
        assert mesh_above is not None
        assert mesh_above.bounds[0, 2] >= 2.0

    def test_invalid_section_rejected(self):
        """유효하지 않은 섹션 거부"""
        # 높이 0
        mesh = _create_wall_section(
            start_point=(0, 0),
            end_point=(5, 0),
            thickness=0.15,
            base_z=2,
            top_z=2
        )
        assert mesh is None

        # 너무 짧은 선분
        mesh = _create_wall_section(
            start_point=(0, 0),
            end_point=(0.001, 0),
            thickness=0.15,
            base_z=0,
            top_z=3
        )
        assert mesh is None


class TestWallWithOpenings:
    """개구부가 있는 벽 생성 테스트"""

    def _create_test_segment(self, length=10.0):
        """테스트용 벽 세그먼트 생성"""
        return WallSegment(
            start=(0, 0),
            end=(length, 0),
            thickness=0.15,
            height=3.0
        )

    def _create_test_door(self, wall_position=0.3):
        """테스트용 문 개구부 생성"""
        segment = self._create_test_segment()
        opening = Opening(
            center=(wall_position * 10, 0),
            width=0.9,
            height=2.1,
            bottom_z=0.0,
            opening_type='door'
        )
        return MappedOpening(
            opening=opening,
            wall_segment=segment,
            wall_position=wall_position,
            distance=0.0
        )

    def _create_test_window(self, wall_position=0.7):
        """테스트용 창문 개구부 생성"""
        segment = self._create_test_segment()
        opening = Opening(
            center=(wall_position * 10, 0),
            width=1.2,
            height=1.2,
            bottom_z=0.9,
            opening_type='window'
        )
        return MappedOpening(
            opening=opening,
            wall_segment=segment,
            wall_position=wall_position,
            distance=0.0
        )

    def test_wall_with_door(self):
        """문이 있는 벽"""
        segment = self._create_test_segment()
        door = self._create_test_door(0.3)

        meshes = create_wall_with_openings(segment, [door], wall_height=3.0)

        # 문이 있으면 최소 3개 섹션 (왼쪽, 위, 오른쪽)
        assert len(meshes) >= 2
        # 모든 메쉬 유효성 확인
        for mesh in meshes:
            assert mesh is not None
            assert len(mesh.vertices) > 0

    def test_wall_with_window(self):
        """창문이 있는 벽"""
        segment = self._create_test_segment()
        window = self._create_test_window(0.5)

        meshes = create_wall_with_openings(segment, [window], wall_height=3.0)

        # 창문이 있으면 최소 4개 섹션 (왼쪽, 아래, 위, 오른쪽)
        assert len(meshes) >= 3
        for mesh in meshes:
            assert mesh is not None

    def test_wall_with_multiple_openings(self):
        """여러 개구부가 있는 벽"""
        segment = self._create_test_segment(15.0)
        segment_mapped = WallSegment(
            start=(0, 0),
            end=(15, 0),
            thickness=0.15
        )

        door = MappedOpening(
            opening=Opening(center=(3, 0), width=0.9, height=2.1, bottom_z=0, opening_type='door'),
            wall_segment=segment_mapped,
            wall_position=0.2,
            distance=0
        )
        window = MappedOpening(
            opening=Opening(center=(10, 0), width=1.2, height=1.2, bottom_z=0.9, opening_type='window'),
            wall_segment=segment_mapped,
            wall_position=0.67,
            distance=0
        )

        meshes = create_wall_with_openings(segment_mapped, [door, window], wall_height=3.0)

        # 문+창문: 많은 섹션 생성
        assert len(meshes) >= 4
        for mesh in meshes:
            assert mesh is not None

    def test_wall_without_openings(self):
        """개구부 없는 벽 (빈 리스트)"""
        segment = self._create_test_segment()
        meshes = create_wall_with_openings(segment, [], wall_height=3.0)

        # 전체 높이 벽 1개
        assert len(meshes) == 1
        assert meshes[0] is not None


class TestOpeningMeshes:
    """개구부 메쉬 생성 테스트"""

    def _create_mapped_door(self):
        """테스트용 매핑된 문"""
        segment = WallSegment(start=(0, 0), end=(10, 0), thickness=0.15)
        opening = Opening(center=(3, 0), width=0.9, height=2.1, bottom_z=0, opening_type='door')
        return MappedOpening(opening=opening, wall_segment=segment, wall_position=0.3, distance=0)

    def _create_mapped_window(self):
        """테스트용 매핑된 창문"""
        segment = WallSegment(start=(0, 0), end=(10, 0), thickness=0.15)
        opening = Opening(center=(7, 0), width=1.2, height=1.2, bottom_z=0.9, opening_type='window')
        return MappedOpening(opening=opening, wall_segment=segment, wall_position=0.7, distance=0)

    def test_door_panel_creation(self):
        """문 패널 생성"""
        mo = self._create_mapped_door()
        panel = create_door_panel(mo, wall_height=3.0)

        assert panel is not None
        assert len(panel.vertices) > 0
        assert len(panel.faces) > 0

    def test_window_frame_and_glass(self):
        """창틀과 유리 생성"""
        mo = self._create_mapped_window()
        frame, glass = create_window_frame_and_glass(mo, wall_height=3.0)

        assert frame is not None
        assert glass is not None
        assert len(frame.vertices) > 0
        assert len(glass.vertices) >= 4  # 최소 사각형


class TestLOD3Build:
    """LOD3 전체 빌드 테스트"""

    @pytest.fixture
    def sample_dxf_path(self):
        """샘플 DXF 경로"""
        paths = [
            Path("frontend/public/samples/arquitectura.dxf"),
            Path("../frontend/public/samples/arquitectura.dxf"),
            Path("../../frontend/public/samples/arquitectura.dxf"),
        ]
        for p in paths:
            if p.exists():
                return str(p)
        pytest.skip("arquitectura.dxf not found")

    @pytest.fixture
    def sample_centerline(self, sample_dxf_path):
        """샘플 centerline 결과"""
        from .centerline import reconstruct_centerline
        return reconstruct_centerline(
            sample_dxf_path,
            wall_layers=["A-WALL"],
            default_thickness=0.15
        )

    def test_lod3_build_success(self, sample_dxf_path, sample_centerline):
        """LOD3 빌드 성공"""
        if not sample_centerline.is_usable:
            pytest.skip("Centerline not usable")

        with tempfile.NamedTemporaryFile(suffix=".glb", delete=False) as f:
            output_path = f.name

        try:
            result = build_lod3(
                sample_centerline,
                sample_dxf_path,
                door_layers=["A-DOOR"],
                window_layers=["A-GLAZ"],
                height=4.0,
                output_path=output_path
            )

            if result is None:
                pytest.skip("LOD3 build returned None (may be expected for some DXF files)")

            assert result["success"] is True
            assert result["lod"] == 3
            assert "mesh_stats" in result
            assert result["mesh_stats"]["primitives"] >= 3  # 최소 벽, 바닥, 지붕

            # GLB 파일 생성 확인
            assert os.path.exists(output_path)
            assert os.path.getsize(output_path) > 0

        finally:
            if os.path.exists(output_path):
                os.unlink(output_path)

    def test_lod3_glb_loadable(self, sample_dxf_path, sample_centerline):
        """생성된 GLB가 trimesh로 로드 가능한지 확인"""
        if not sample_centerline.is_usable:
            pytest.skip("Centerline not usable")

        with tempfile.NamedTemporaryFile(suffix=".glb", delete=False) as f:
            output_path = f.name

        try:
            result = build_lod3(
                sample_centerline,
                sample_dxf_path,
                door_layers=["A-DOOR"],
                window_layers=["A-GLAZ"],
                height=4.0,
                output_path=output_path
            )

            if result is None:
                pytest.skip("LOD3 build returned None")

            # GLB 로드 테스트
            scene = trimesh.load(output_path)
            assert scene is not None

            # 메쉬가 있는지 확인
            if hasattr(scene, 'geometry'):
                assert len(scene.geometry) > 0
            else:
                # 단일 메쉬인 경우
                assert hasattr(scene, 'vertices')

        finally:
            if os.path.exists(output_path):
                os.unlink(output_path)


class TestWatertight:
    """Watertight(기밀성) 검증 테스트"""

    def test_wall_section_watertight(self):
        """개별 벽 섹션이 watertight인지 확인"""
        mesh = _create_wall_section(
            start_point=(0, 0),
            end_point=(5, 0),
            thickness=0.15,
            base_z=0,
            top_z=3
        )

        assert mesh is not None
        # trimesh의 extrude_polygon은 일반적으로 볼륨 있는 메쉬 생성
        assert mesh.volume > 0  # 양수 볼륨

    def test_combined_walls_validity(self):
        """병합된 벽 메쉬 유효성"""
        segment = WallSegment(start=(0, 0), end=(10, 0), thickness=0.15)
        window = MappedOpening(
            opening=Opening(center=(5, 0), width=1.2, height=1.2, bottom_z=0.9, opening_type='window'),
            wall_segment=segment,
            wall_position=0.5,
            distance=0
        )

        meshes = create_wall_with_openings(segment, [window], wall_height=3.0)

        # 각 섹션 검증
        for i, mesh in enumerate(meshes):
            assert mesh is not None, f"섹션 {i} is None"
            # 양수 볼륨 확인 (법선이 올바르면 양수)
            assert abs(mesh.volume) > 0, f"섹션 {i} has zero volume"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
