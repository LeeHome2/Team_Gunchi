/**
 * AI 스코어링 엔진
 * 주차 편의성, 일조량, 배치 적절성을 종합 평가
 */

interface ScoringInput {
  parkingDistance: number;    // 주차 입구까지 거리 (m)
  sunlightHours: number;      // 평균 일조시간 (h)
  angleFromSouth?: number;    // 메인 창의 방향과 정남향의 차이 각도 (0도 ~ 180도)
  // 배치 규정 점수 산출용
  violationCount?: number;        // 건폐율/이격/높이 위반 카운트 (0~3)
  isOutOfBounds?: boolean;        // 건물이 건축선 영역 밖이면 true
  effectiveAreaRatio?: number;    // 유효면적/대지면적 (0~1)
  preferences: {
    parkingFitness?: boolean;
    southFacing?: boolean;
    layoutAppropriateness?: boolean;
  };
}

interface ScoringOutput {
  overall: number;
  categories: {
    parking: number;
    sunlight: number;
    layout: number;
  };
}

export const calculateVariantScore = (input: ScoringInput): ScoringOutput => {
  const {
    parkingDistance,
    sunlightHours,
    angleFromSouth = 0,
    violationCount = 0,
    isOutOfBounds = false,
    effectiveAreaRatio = 1,
    preferences,
  } = input;

  // 1. 주차 점수 산출 (경로가 짧을수록 높은 점수)
  // 10m 이하: 100점, 10m~50m: 선형 감점, 50m 이상: 50점, 100m 이상: 30점
  let parkingScore: number;
  if (parkingDistance <= 10) {
    parkingScore = 100;
  } else if (parkingDistance <= 50) {
    // 10m~50m 구간: 100점에서 50점까지 선형 감소
    parkingScore = 100 - ((parkingDistance - 10) / 40) * 50;
  } else if (parkingDistance <= 100) {
    // 50m~100m 구간: 50점에서 30점까지 선형 감소
    parkingScore = 50 - ((parkingDistance - 50) / 50) * 20;
  } else {
    parkingScore = 30; // 100m 이상도 최소 30점
  }

  // 토글 즉시 반영되도록 sunlight/layout 가중치와 동일한 점수 기준으로 통일.
  // 기존엔 거리 임계값(20, 50m) 양극단만 가중치를 받아, 20~50m 구간이나
  // 경로 미설정(디폴트 50m) 케이스에서 토글 효과가 0이었다.
  if (preferences.parkingFitness) {
    if (parkingScore >= 80) parkingScore = Math.min(100, parkingScore + 10);
    else parkingScore = Math.max(0, parkingScore - 10);
  }

  // 2. 일조 점수 산출 (10시간 이상 100점, 1시간당 10점 감점, 3시간 이하 30점)
  let sunlightScore = sunlightHours * 10;

  if (sunlightHours >= 10) {
    sunlightScore = 100;
  } else if (sunlightHours <= 3) {
    sunlightScore = 30;
  }

  // 일조량 가중치 선호도 반영
  if (preferences.southFacing) {
    if (sunlightHours >= 4) sunlightScore = Math.min(100, sunlightScore + 15);
    else sunlightScore = Math.max(0, sunlightScore - 15);
  }

  // 3. 배치 규정 점수 산출
  //   - 영역 이탈: 0 점
  //   - 그 외: 유효면적 비율(주차/통로 제외 후 남은 대지 비율) 을 점수에
  //     직접 매핑하여 plan 별 변별력 확보. 40 + ratio*60 (ratio 0 → 40,
  //     1.0 → 100). 같은 대지/매스라도 주차·통로 면적 작을수록 점수↑.
  //   - 위반 사항(이격/건폐율/높이) 1건당 -25 점 추가 감점.
  let layoutScore: number;
  if (isOutOfBounds) {
    layoutScore = 0;
  } else {
    const clampedRatio = Math.max(0, Math.min(1, effectiveAreaRatio));
    layoutScore = 40 + clampedRatio * 60;
    layoutScore -= violationCount * 25;
  }
  layoutScore = Math.max(0, Math.min(100, layoutScore));

  // 배치 선호도 가중치 반영
  if (preferences.layoutAppropriateness) {
    if (layoutScore >= 80) layoutScore = Math.min(100, layoutScore + 10);
    else layoutScore = Math.max(0, layoutScore - 10);
  }
  // angleFromSouth(메인 창 방향) 는 sunlightScore 의 windowFactor 보정에서만
  // 사용되며 layoutScore 에는 영향 없음 (다른 호출처 호환 위해 인자 유지).

  // 4. 총점 계산 (평균)
  const overallScore = Math.round((parkingScore + sunlightScore + layoutScore) / 3);

  return {
    overall: overallScore,
    categories: {
      parking: Math.round(parkingScore),
      sunlight: Math.round(sunlightScore),
      layout: Math.round(layoutScore)
    }
  };
};
