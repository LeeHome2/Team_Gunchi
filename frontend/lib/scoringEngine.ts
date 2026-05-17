/**
 * AI 스코어링 엔진
 * 주차 편의성, 일조량, 배치 적절성을 종합 평가
 */

interface ScoringInput {
  parkingDistance: number;    // 주차 입구까지 거리 (m)
  sunlightHours: number;      // 평균 일조시간 (h)
  angleFromSouth?: number;    // 메인 창의 방향과 정남향의 차이 각도 (0도 ~ 180도)
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
  const { parkingDistance, sunlightHours, angleFromSouth = 0, preferences } = input;

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

  if (preferences.parkingFitness) {
    if (parkingDistance <= 20) parkingScore = Math.min(100, parkingScore * 1.1);
    else if (parkingDistance > 50) parkingScore = Math.max(30, parkingScore * 0.9);
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

  // 3. 배치 점수 산출 (정남향 100점, 10도 틀어질 때마다 4점 감점)
  const deviationSteps = Math.floor(angleFromSouth / 10);
  let layoutScore = 100 - (deviationSteps * 4);

  // 방어 로직: 28점~100점 사이를 벗어나지 않게 고정
  layoutScore = Math.max(28, Math.min(100, layoutScore));

  // 배치 선호도 가중치 반영
  if (preferences.layoutAppropriateness) {
    if (layoutScore >= 80) layoutScore = Math.min(100, layoutScore + 10);
    else layoutScore = Math.max(28, layoutScore - 10);
  }

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
