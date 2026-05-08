"""
Phase 1 단위 테스트: 벽 centerline 재구성.

테스트 케이스:
1. LINE 평행선 두 줄 → centerline 추출
2. LWPOLYLINE 닫힌 폴리곤 → WallLoop
3. LWPOLYLINE 열린 폴리라인 → WallSegment 목록
4. 혼합 케이스 (LINE + LWPOLYLINE)
5. 실패 케이스 (빈 레이어, 잘못된 경로)
"""

import os
import sys
import tempfile
import pytest

# 프로젝트 루트 추가
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

import ezdxf
from services.lod import (
    reconstruct_centerline,
    WallSegment,
    WallLoop,
    CenterlineResult,
)
from services.lod.centerline import match_parallel_lines, process_lwpolyline


# ============= 합성 DXF 생성 헬퍼 =============

def create_test_dxf(entities_func) -> str:
    """테스트용 DXF 파일 생성, 임시 파일 경로 반환"""
    doc = ezdxf.new('R2010')
    msp = doc.modelspace()
    doc.layers.add('WALL')
    entities_func(msp)

    fd, path = tempfile.mkstemp(suffix='.dxf')
    os.close(fd)
    doc.saveas(path)
    return path


# ============= 테스트 케이스 =============

class TestParallelLineMatching:
    """LINE 평행선 매칭 테스트"""

    def test_simple_parallel_pair(self):
        """간단한 평행선 쌍 → centerline 추출"""
        def add_entities(msp):
            # 두 평행선 (거리 0.3m)
            msp.add_line((0, 0), (10, 0), dxfattribs={'layer': 'WALL'})
            msp.add_line((0, 0.3), (10, 0.3), dxfattribs={'layer': 'WALL'})

        path = create_test_dxf(add_entities)
        try:
            result = reconstruct_centerline(path, ['WALL'])
            assert result.success_rate >= 0.8
            assert result.total_segments >= 1
            # centerline은 y=0.15에 있어야 함
            seg = result.segments[0]
            assert abs(seg.start[1] - 0.15) < 0.01
            assert abs(seg.thickness - 0.3) < 0.01
        finally:
            os.unlink(path)

    def test_opposite_direction_lines(self):
        """반대 방향 평행선도 매칭되어야 함"""
        def add_entities(msp):
            msp.add_line((0, 0), (10, 0), dxfattribs={'layer': 'WALL'})
            msp.add_line((10, 0.2), (0, 0.2), dxfattribs={'layer': 'WALL'})  # 반대 방향

        path = create_test_dxf(add_entities)
        try:
            result = reconstruct_centerline(path, ['WALL'])
            assert result.total_segments >= 1
            assert abs(result.segments[0].thickness - 0.2) < 0.01
        finally:
            os.unlink(path)

    def test_single_line_default_thickness(self):
        """단일 LINE → 기본 두께 적용"""
        def add_entities(msp):
            msp.add_line((0, 0), (5, 0), dxfattribs={'layer': 'WALL'})

        path = create_test_dxf(add_entities)
        try:
            result = reconstruct_centerline(path, ['WALL'], default_thickness=0.15)
            assert result.total_segments == 1
            assert abs(result.segments[0].thickness - 0.15) < 0.01
        finally:
            os.unlink(path)


class TestLWPolylineProcessing:
    """LWPOLYLINE 처리 테스트"""

    def test_closed_polyline_to_loop(self):
        """닫힌 LWPOLYLINE → WallLoop"""
        def add_entities(msp):
            # 닫힌 사각형
            msp.add_lwpolyline(
                [(0, 0), (10, 0), (10, 8), (0, 8)],
                close=True,
                dxfattribs={'layer': 'WALL'}
            )

        path = create_test_dxf(add_entities)
        try:
            result = reconstruct_centerline(path, ['WALL'])
            assert result.total_loops == 1
            assert len(result.loops[0].points) == 4
        finally:
            os.unlink(path)

    def test_open_polyline_to_segments(self):
        """열린 LWPOLYLINE → WallSegment 목록"""
        def add_entities(msp):
            # 열린 L자형
            msp.add_lwpolyline(
                [(0, 0), (5, 0), (5, 3)],
                close=False,
                dxfattribs={'layer': 'WALL'}
            )

        path = create_test_dxf(add_entities)
        try:
            result = reconstruct_centerline(path, ['WALL'])
            # 2개 세그먼트: (0,0)-(5,0), (5,0)-(5,3)
            assert result.total_segments == 2
        finally:
            os.unlink(path)


class TestMixedEntities:
    """혼합 케이스 테스트"""

    def test_lines_and_polylines_mixed(self):
        """LINE + LWPOLYLINE 혼합"""
        def add_entities(msp):
            # 평행선 쌍
            msp.add_line((0, 0), (8, 0), dxfattribs={'layer': 'WALL'})
            msp.add_line((0, 0.25), (8, 0.25), dxfattribs={'layer': 'WALL'})
            # 닫힌 폴리라인
            msp.add_lwpolyline(
                [(10, 0), (15, 0), (15, 5), (10, 5)],
                close=True,
                dxfattribs={'layer': 'WALL'}
            )

        path = create_test_dxf(add_entities)
        try:
            result = reconstruct_centerline(path, ['WALL'])
            assert result.success_rate >= 0.8
            assert result.total_segments >= 1  # LINE 쌍
            assert result.total_loops >= 1     # LWPOLYLINE
        finally:
            os.unlink(path)


class TestFailureCases:
    """실패 케이스 테스트"""

    def test_empty_layer(self):
        """빈 레이어 → 빈 결과"""
        def add_entities(msp):
            msp.add_line((0, 0), (5, 0), dxfattribs={'layer': 'OTHER'})

        path = create_test_dxf(add_entities)
        try:
            result = reconstruct_centerline(path, ['WALL'])  # 'OTHER' 레이어는 무시
            assert result.total_segments == 0
            assert result.total_loops == 0
        finally:
            os.unlink(path)

    def test_invalid_path(self):
        """잘못된 경로 → 실패 결과"""
        result = reconstruct_centerline('/nonexistent/path.dxf', ['WALL'])
        assert result.success_rate == 0.0
        assert len(result.warnings) > 0

    def test_short_lines_ignored(self):
        """너무 짧은 LINE은 무시 (< 10cm)"""
        def add_entities(msp):
            msp.add_line((0, 0), (0.05, 0), dxfattribs={'layer': 'WALL'})  # 5cm

        path = create_test_dxf(add_entities)
        try:
            result = reconstruct_centerline(path, ['WALL'])
            assert result.total_segments == 0  # 너무 짧아서 무시
        finally:
            os.unlink(path)


class TestRealDatasets:
    """실제 데이터셋 테스트 (파일 존재 시에만)"""

    @pytest.fixture
    def samples_dir(self):
        base = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
        return os.path.join(base, 'frontend', 'public', 'samples')

    def test_arquitectura_dxf(self, samples_dir):
        """arquitectura.dxf 테스트 (메인 픽스처)"""
        path = os.path.join(samples_dir, 'arquitectura.dxf')
        if not os.path.exists(path):
            pytest.skip("arquitectura.dxf not found")

        result = reconstruct_centerline(
            path,
            ['MURO', 'MURO BAJO.', 'VIGAS', 'MuroBaj', 'CUADRO']
        )
        # DoD: 80% 이상 성공률
        assert result.success_rate >= 0.8, f"Success rate {result.success_rate:.1%} < 80%"
        assert result.is_usable

    def test_trabajo_final_dxf(self, samples_dir):
        """trabajo_final.dxf 테스트 (LINE 평행선 패턴)"""
        path = os.path.join(samples_dir, 'trabajo_final.dxf')
        if not os.path.exists(path):
            pytest.skip("trabajo_final.dxf not found")

        result = reconstruct_centerline(path, ['Muros'])
        assert result.success_rate >= 0.8
        assert result.is_usable
        # LINE 평행선이므로 세그먼트만 있어야 함
        assert result.total_segments > 0


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
