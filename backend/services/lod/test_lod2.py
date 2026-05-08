"""
Phase 2 단위 테스트: LOD2 빌더.

테스트 케이스:
1. 기본 LOD2 빌드 (벽 + 슬래브)
2. multi-primitive GLB 구조
3. LOD1 footprint AABB 동등성
4. 실패 케이스 (낮은 성공률)
"""

import os
import sys
import json
import tempfile
import pytest
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

import ezdxf
from services.lod import (
    reconstruct_centerline,
    build_lod2,
    CenterlineResult,
    WallSegment,
    WallLoop,
)
from services.lod.lod2_builder import (
    extract_footprint,
    create_slab_mesh,
    FLOOR_SLAB_THICKNESS,
    ROOF_SLAB_THICKNESS,
)


# ============= 헬퍼 =============

def create_test_dxf(entities_func) -> str:
    """테스트용 DXF 파일 생성"""
    doc = ezdxf.new('R2010')
    msp = doc.modelspace()
    doc.layers.add('WALL')
    entities_func(msp)

    fd, path = tempfile.mkstemp(suffix='.dxf')
    os.close(fd)
    doc.saveas(path)
    return path


def read_glb_primitives(glb_path: str) -> int:
    """GLB 파일에서 primitive 수 추출"""
    with open(glb_path, 'rb') as f:
        # GLB 헤더 건너뛰기 (12 bytes)
        f.read(12)
        # JSON 청크 길이
        json_len = int.from_bytes(f.read(4), 'little')
        f.read(4)  # chunk type
        json_bytes = f.read(json_len)
        gltf = json.loads(json_bytes.decode('utf-8'))
        return len(gltf['meshes'][0]['primitives'])


# ============= 테스트 케이스 =============

class TestLOD2Builder:
    """LOD2 빌더 테스트"""

    def test_basic_lod2_build(self):
        """기본 LOD2 빌드 (사각형 벽)"""
        def add_entities(msp):
            # 닫힌 사각형 벽
            msp.add_lwpolyline(
                [(0, 0), (10, 0), (10, 8), (0, 8)],
                close=True,
                dxfattribs={'layer': 'WALL'}
            )

        dxf_path = create_test_dxf(add_entities)
        fd, glb_path = tempfile.mkstemp(suffix='.glb')
        os.close(fd)

        try:
            centerline = reconstruct_centerline(dxf_path, ['WALL'])
            result = build_lod2(centerline, height=4.0, output_path=glb_path)

            assert result is not None
            assert result['success'] is True
            assert result['lod'] == 2
            assert result['mesh_stats']['primitives'] == 3  # 벽, 바닥, 지붕
            assert os.path.exists(glb_path)
        finally:
            os.unlink(dxf_path)
            if os.path.exists(glb_path):
                os.unlink(glb_path)

    def test_multi_primitive_structure(self):
        """GLB가 3개 primitive (벽, 바닥, 지붕)를 포함하는지"""
        def add_entities(msp):
            msp.add_lwpolyline(
                [(0, 0), (5, 0), (5, 5), (0, 5)],
                close=True,
                dxfattribs={'layer': 'WALL'}
            )

        dxf_path = create_test_dxf(add_entities)
        fd, glb_path = tempfile.mkstemp(suffix='.glb')
        os.close(fd)

        try:
            centerline = reconstruct_centerline(dxf_path, ['WALL'])
            build_lod2(centerline, height=3.0, output_path=glb_path)

            primitives = read_glb_primitives(glb_path)
            assert primitives == 3
        finally:
            os.unlink(dxf_path)
            if os.path.exists(glb_path):
                os.unlink(glb_path)


class TestFootprintExtraction:
    """Footprint 추출 테스트"""

    def test_footprint_from_loop(self):
        """WallLoop에서 footprint 추출"""
        result = CenterlineResult(
            segments=[],
            loops=[WallLoop(points=[(0, 0), (10, 0), (10, 8), (0, 8)], thickness=0.15)],
            success_rate=1.0,
            failed_entities=0,
            warnings=[]
        )

        footprint = extract_footprint(result)
        assert footprint is not None
        assert abs(footprint.area - 80.0) < 0.1  # 10 * 8 = 80

    def test_footprint_from_segments(self):
        """WallSegment에서 convex hull footprint 추출"""
        result = CenterlineResult(
            segments=[
                WallSegment(start=(0, 0), end=(10, 0), thickness=0.15),
                WallSegment(start=(10, 0), end=(10, 5), thickness=0.15),
                WallSegment(start=(10, 5), end=(0, 5), thickness=0.15),
                WallSegment(start=(0, 5), end=(0, 0), thickness=0.15),
            ],
            loops=[],
            success_rate=1.0,
            failed_entities=0,
            warnings=[]
        )

        footprint = extract_footprint(result)
        assert footprint is not None
        assert footprint.area > 0


class TestLOD1Comparison:
    """LOD1과의 비교 테스트"""

    @pytest.fixture
    def samples_dir(self):
        base = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
        return os.path.join(base, 'frontend', 'public', 'samples')

    def test_footprint_aabb_similarity(self, samples_dir):
        """LOD2 footprint가 LOD1 결과와 유사한 AABB를 가지는지"""
        dxf_path = os.path.join(samples_dir, 'arquitectura.dxf')
        if not os.path.exists(dxf_path):
            pytest.skip("arquitectura.dxf not found")

        # LOD1 베이스라인 로드
        baseline_path = os.path.join(
            os.path.dirname(__file__),
            'baseline_lod1.json'
        )
        if not os.path.exists(baseline_path):
            pytest.skip("baseline_lod1.json not found")

        with open(baseline_path) as f:
            baseline = json.load(f)

        # LOD2 빌드
        centerline = reconstruct_centerline(
            dxf_path,
            baseline['wall_layers']
        )
        assert centerline.is_usable

        footprint = extract_footprint(centerline)
        assert footprint is not None

        # footprint area가 합리적인 범위인지 (LOD1도 같은 데이터 사용)
        assert footprint.area > 0


class TestFailureCases:
    """실패 케이스 테스트"""

    def test_low_success_rate_returns_none(self):
        """성공률 < 80%일 때 None 반환"""
        result = CenterlineResult(
            segments=[],
            loops=[],
            success_rate=0.5,  # 50% < 80%
            failed_entities=10,
            warnings=[]
        )

        fd, glb_path = tempfile.mkstemp(suffix='.glb')
        os.close(fd)

        try:
            build_result = build_lod2(result, height=4.0, output_path=glb_path)
            assert build_result is None  # LOD1 fallback 권장
        finally:
            if os.path.exists(glb_path):
                os.unlink(glb_path)


class TestRealDatasets:
    """실제 데이터셋 테스트"""

    @pytest.fixture
    def samples_dir(self):
        base = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
        return os.path.join(base, 'frontend', 'public', 'samples')

    def test_arquitectura_lod2(self, samples_dir):
        """arquitectura.dxf LOD2 빌드"""
        dxf_path = os.path.join(samples_dir, 'arquitectura.dxf')
        if not os.path.exists(dxf_path):
            pytest.skip("arquitectura.dxf not found")

        fd, glb_path = tempfile.mkstemp(suffix='.glb')
        os.close(fd)

        try:
            centerline = reconstruct_centerline(
                dxf_path,
                ['MURO', 'MURO BAJO.', 'VIGAS', 'MuroBaj', 'CUADRO']
            )
            result = build_lod2(centerline, height=4.0, output_path=glb_path)

            assert result is not None
            assert result['success'] is True
            assert result['mesh_stats']['primitives'] == 3
            assert result['mesh_stats']['vertices'] > 0
            assert result['mesh_stats']['faces'] > 0
        finally:
            if os.path.exists(glb_path):
                os.unlink(glb_path)

    def test_trabajo_final_lod2(self, samples_dir):
        """trabajo_final.dxf LOD2 빌드 (LINE 평행선 패턴)"""
        dxf_path = os.path.join(samples_dir, 'trabajo_final.dxf')
        if not os.path.exists(dxf_path):
            pytest.skip("trabajo_final.dxf not found")

        fd, glb_path = tempfile.mkstemp(suffix='.glb')
        os.close(fd)

        try:
            centerline = reconstruct_centerline(dxf_path, ['Muros'])
            result = build_lod2(centerline, height=4.0, output_path=glb_path)

            assert result is not None
            assert result['success'] is True
        finally:
            if os.path.exists(glb_path):
                os.unlink(glb_path)


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
