# 데이터셋 벽 엔티티 패턴 분석

> Phase 0.5 작업 결과. Phase 1 centerline 알고리즘 설계의 입력 분포 파악용.

분석일: 2026-05-08

---

## 샘플 DXF 파일 (4개)

| 파일명 | 벽 레이어 | 주요 패턴 | 비고 |
|--------|----------|----------|------|
| arquitectura.dxf | MURO, MURO BAJO., VIGAS, MuroBaj, CUADRO | LWPOLYLINE 위주 + LINE 혼합 | 메인 테스트 픽스처 |
| casa_velacion_1.dxf | (없음) | - | 전기 도면, 벽 레이어 없음 |
| casa_velacion_2.dxf | (없음) | - | 전기 도면, 벽 레이어 없음 |
| trabajo_final.dxf | Muros | LINE 96개 (평행선) | LINE 두 줄 패턴 |

---

## 상세 분석

### 1. arquitectura.dxf (메인 테스트 픽스처)

```
Total layers: 29
Wall-related layers: ['MURO', 'MURO BAJO.', 'VIGAS', 'MuroBaj', 'CUADRO']

[MURO] entities:
  - LWPOLYLINE: 20
  - LINE: 4

[MURO BAJO.] entities:
  - LWPOLYLINE: 14
  - LINE: 2

[VIGAS] entities:
  - LWPOLYLINE: 16
  - LINE: 26
```

**패턴 분류**:
- (a) LWPOLYLINE 단일: 대부분 (닫힌 외곽선 또는 열린 폴리라인)
- (b) LINE: 소수 (평행선 두 줄 또는 단일 LINE)
- **혼합 케이스**: MURO/VIGAS 레이어에서 LWPOLYLINE + LINE 혼재

### 2. trabajo_final.dxf

```
Total layers: 8
Wall-related layers: ['Muros']

[Muros] entities:
  - LINE: 96
  - HATCH: 1
```

**패턴 분류**:
- (b) 평행선 두 줄: LINE 96개 → 48쌍 추정
- HATCH: 벽체 채움 (detect 단계에서 제거됨)

---

## Phase 1 알고리즘 설계 시사점

1. **LWPOLYLINE 처리 필수**: arquitectura.dxf의 주요 패턴
   - 닫힌 LWPOLYLINE → 외곽선으로 처리 (두께는 offset)
   - 열린 LWPOLYLINE → centerline으로 변환

2. **LINE 평행선 매칭**: trabajo_final.dxf의 주요 패턴
   - 방향 cos > 0.95, 거리 0.5~5m 범위로 쌍 매칭
   - 중점 + 두께 추출

3. **혼합 케이스 처리**: arquitectura.dxf의 VIGAS 레이어
   - 같은 레이어에 LWPOLYLINE + LINE 혼재
   - 타입별 분기 후 각각 처리

4. **폴백 전략**:
   - 패턴 인식 실패 시 LOD1 폴백
   - casa_velacion 같은 벽 레이어 없는 도면 → footprint 기반 박스 생성

---

## 다음 단계

- [ ] Phase 1: 벽 centerline 재구성 알고리즘 구현
  - LWPOLYLINE → centerline 변환
  - LINE 평행선 매칭
  - 혼합 케이스 처리
