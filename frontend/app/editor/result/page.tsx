'use client'

/**
 * 결과 확인 페이지 — 에디터 "결과 확인" 버튼에서 진입.
 *
 * 표시 요소:
 *   · 프로젝트 / 대지 메타 정보 상단 바
 *   · 배치도 카드 (Cesium 탑다운 스크린샷, `projectStore.resultSnapshot.sitePlan`)
 *     — 나중에 학교 LLM 이미지 생성 기능이 붙으면 이 샷을 입력으로 넘겨
 *       배치도 스타일 이미지로 교체할 수 있다.
 *   · 조감도 카드 (STAGE 6 이미지 생성 AI 플레이스홀더)
 *   · 규정 검토 요약 카드 (건폐율 / 이격거리 / 높이 / 일조권)
 *   · 위반 사항 목록
 *
 * 이 페이지는 `projectStore` 의 스냅샷과 validation 을 읽기만 한다.
 * store 가 비어있으면 (예: 새로고침) 에디터로 돌아가라고 안내한다.
 */

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo } from 'react'
import Brand from '@/components/Brand'
import { useProjectStore } from '@/store/projectStore'
import { requestAIScoring } from '@/lib/analysisApi'

type StatusKey = 'pass' | 'fail' | 'warning' | 'unknown'

const statusFromRaw = (s?: string | null): StatusKey => {
  if (!s) return 'unknown'
  const key = s.toLowerCase()
  if (key === 'pass' || key === 'ok') return 'pass'
  if (key === 'warning') return 'warning'
  if (key === 'fail' || key === 'violation') return 'fail'
  return 'unknown'
}

const STATUS_STYLES: Record<StatusKey, { label: string; badge: string; ring: string }> = {
  pass: {
    label: '적합',
    badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    ring: 'ring-emerald-500/40',
  },
  fail: {
    label: '부적합',
    badge: 'bg-red-500/15 text-red-300 border-red-500/30',
    ring: 'ring-red-500/40',
  },
  warning: {
    label: '주의',
    badge: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    ring: 'ring-amber-500/40',
  },
  unknown: {
    label: '미검토',
    badge: 'bg-white/10 text-white/60 border-white/10',
    ring: 'ring-white/10',
  },
}

const fmt = (n: number | null | undefined, unit = '', digits = 2) => {
  if (n == null || Number.isNaN(n)) return '—'
  return `${n.toLocaleString('ko-KR', { maximumFractionDigits: digits, minimumFractionDigits: digits })}${unit}`
}

const fmtCoord = (lon?: number | null, lat?: number | null) => {
  if (lon == null || lat == null) return '—'
  return `${lon.toFixed(6)}°, ${lat.toFixed(6)}°`
}

const fmtDate = (iso?: string | null) => {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    return d.toLocaleString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

// ─── 서브 컴포넌트 ───────────────────────────────────────
function MetaBar({
  projectName,
  address,
  coordinate,
  capturedAt,
}: {
  projectName: string
  address: string
  coordinate: string
  capturedAt: string
}) {
  return (
    <div className="card px-6 py-4 flex flex-wrap items-center gap-x-10 gap-y-3">
      <div>
        <div className="text-xs text-white/40 uppercase tracking-wider mb-0.5">프로젝트</div>
        <div className="text-base font-semibold text-white">{projectName}</div>
      </div>
      <div className="border-l border-white/10 pl-10">
        <div className="text-xs text-white/40 uppercase tracking-wider mb-0.5">주소</div>
        <div className="text-sm text-white/80">{address}</div>
      </div>
      <div className="border-l border-white/10 pl-10">
        <div className="text-xs text-white/40 uppercase tracking-wider mb-0.5">중심 좌표</div>
        <div className="text-sm text-white/80 font-mono">{coordinate}</div>
      </div>
      <div className="border-l border-white/10 pl-10 ml-auto">
        <div className="text-xs text-white/40 uppercase tracking-wider mb-0.5">캡처 시각</div>
        <div className="text-sm text-white/80">{capturedAt}</div>
      </div>
    </div>
  )
}

function DiagramCard({
  title,
  subtitle,
  imageSrc,
  placeholderLabel,
  placeholderHint,
  badge,
}: {
  title: string
  subtitle: string
  imageSrc: string | null
  placeholderLabel: string
  placeholderHint: string
  badge?: string
}) {
  return (
    <div className="card overflow-hidden flex flex-col">
      <div className="px-5 py-4 flex items-center justify-between border-b border-white/5">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-white">{title}</h3>
            {badge && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-brand-500/15 text-brand-200 border border-brand-500/20">
                {badge}
              </span>
            )}
          </div>
          <p className="text-xs text-white/40 mt-0.5">{subtitle}</p>
        </div>
      </div>
      <div className="relative aspect-[16/10] bg-navy-950 flex items-center justify-center">
        {imageSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageSrc}
            alt={title}
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="text-center px-8">
            <div className="w-14 h-14 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-3">
              <svg className="w-7 h-7 text-white/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <div className="text-sm font-medium text-white/70 mb-1">{placeholderLabel}</div>
            <div className="text-xs text-white/40 max-w-xs">{placeholderHint}</div>
          </div>
        )}
      </div>
    </div>
  )
}

function SummaryCard({
  label,
  value,
  limit,
  status,
}: {
  label: string
  value: string
  limit: string
  status: StatusKey
}) {
  const s = STATUS_STYLES[status]
  return (
    <div className={`card p-4 ring-1 ${s.ring}`}>
      <div className="flex items-start justify-between mb-3">
        <div className="text-sm text-white/60">{label}</div>
        <span className={`text-[11px] px-2 py-0.5 rounded border ${s.badge}`}>
          {s.label}
        </span>
      </div>
      <div className="text-2xl font-semibold text-white tabular-nums">{value}</div>
      <div className="text-xs text-white/40 mt-1">기준 {limit}</div>
    </div>
  )
}

// ─── 메인 페이지 ─────────────────────────────────────────
export default function ResultPage() {
  const router = useRouter()
  const { workArea, site, building, validation, reviewData, resultSnapshot, modelTransform, parkingZone, parkingConfig, sunlightAnalysisState, aiScore, setAIScore } =
    useProjectStore()

  // 데이터가 아예 없으면 에디터로 유도
  const hasAnyData = validation || reviewData?.buildingCoverage || site || building || resultSnapshot.sitePlan
  useEffect(() => {
    // 새로고침 등으로 store 가 비어있는 경우 — 자동 리다이렉트 대신
    // 안내 화면을 띄워 사용자가 컨트롤하게 한다.
  }, [])

  const projectName = useMemo(() => {
    if (typeof window === 'undefined') return '현재 프로젝트'
    try {
      const cached = sessionStorage.getItem('geonchi_last_project_name')
      if (cached) return cached
    } catch {
      /* ignore */
    }
    return '현재 프로젝트'
  }, [])

  const lon = modelTransform?.longitude ?? workArea?.longitude ?? null
  const lat = modelTransform?.latitude ?? workArea?.latitude ?? null

  // AI 스코어링 요청
  const handleAIScoring = useCallback(async () => {
    setAIScore({ isLoading: true, error: null })
    try {
      // 주차 데이터 조립
      const parkingData = parkingZone ? {
        required_total: parkingConfig?.requiredTotal ?? 0,
        placed_total: parkingZone.totalSlots,
        required_disabled: parkingConfig?.requiredDisabled ?? 0,
        placed_disabled: parkingZone.disabledSlots,
        total_area_m2: parkingZone.totalAreaM2,
        parking_area_ratio: parkingZone.parkingAreaRatio,
      } : null

      // 일조 데이터 조립
      const sunlightData = sunlightAnalysisState?.result ? {
        avg_sunlight_hours: sunlightAnalysisState.result.averageSunlightHours,
        min_sunlight_hours: sunlightAnalysisState.result.minSunlightHours,
        max_sunlight_hours: sunlightAnalysisState.result.maxSunlightHours,
        total_points: sunlightAnalysisState.result.totalPoints,
      } : null

      const res = await requestAIScoring(validation, parkingData, sunlightData)

      setAIScore({
        isLoading: false,
        result: {
          categoryGrades: res.category_grades,
          overallScore: res.overall_score,
          summary: res.summary,
          suggestions: res.suggestions,
          source: res.source,
        },
        error: res.error || null,
      })
    } catch (e: any) {
      setAIScore({ isLoading: false, error: e.message || 'AI 스코어링 실패' })
    }
  }, [validation, parkingZone, parkingConfig, sunlightAnalysisState, setAIScore])

  // validation이 비어있으면 reviewData(검토 탭에서 계산된 값)으로 fallback.
  // 검토 탭은 reviewData에 저장하지만 result 페이지는 validation을 읽으므로 매핑이 필요.
  const cov = validation?.building_coverage ?? (reviewData?.buildingCoverage ? {
    value: reviewData.buildingCoverage.ratio,
    limit: reviewData.buildingCoverage.limit,
    status: reviewData.buildingCoverage.status === 'OK' ? 'OK' : 'fail',
    building_area: reviewData.buildingCoverage.buildingArea,
    site_area: reviewData.buildingCoverage.siteArea,
  } : null)

  const setback = validation?.setback ?? (reviewData?.setback ? {
    min_distance_m: reviewData.setback.minDistance,
    required_m: reviewData.setback.required,
    status: reviewData.setback.status === 'OK' ? 'OK' : 'fail',
  } : null)

  // validation에 height 정보가 없으면 building.height + 용도지역 한도로 추정
  const height = validation?.height ?? (building?.height != null ? {
    value_m: building.height,
    limit_m: null,
    status: 'unknown',
  } : null)

  // 위반 사항: validation 우선, 없으면 reviewData에서 자동 생성
  const violations = validation?.violations ?? (() => {
    const v: { code: string; message: string }[] = []
    if (reviewData?.buildingCoverage?.status === 'VIOLATION') {
      v.push({
        code: 'COVERAGE_EXCEED',
        message: `건폐율 ${reviewData.buildingCoverage.ratio.toFixed(1)}% 가 한도 ${reviewData.buildingCoverage.limit}% 를 초과합니다`,
      })
    }
    if (reviewData?.setback?.status === 'VIOLATION') {
      v.push({
        code: 'SETBACK_VIOLATION',
        message: `이격거리 ${reviewData.setback.minDistance.toFixed(2)}m 가 최소 ${reviewData.setback.required}m 미만입니다`,
      })
    }
    if (reviewData && reviewData.buildingCoverage && reviewData.isModelInBounds === false) {
      v.push({
        code: 'OUT_OF_BOUNDS',
        message: '건물 매스가 선택 영역을 벗어났습니다',
      })
    }
    return v
  })()

  // 종합 status: validation 우선, 없으면 reviewData / violations 기반
  const overallStatus: StatusKey = (() => {
    if (validation?.is_valid === true) return 'pass'
    if (validation?.is_valid === false) return 'fail'
    if (violations.length > 0) return 'fail'
    if (reviewData?.buildingCoverage || reviewData?.setback) {
      // reviewData가 있고 위반사항이 없으면 적합
      const allOk =
        (!reviewData.buildingCoverage || reviewData.buildingCoverage.status === 'OK') &&
        (!reviewData.setback || reviewData.setback.status === 'OK') &&
        reviewData.isModelInBounds !== false
      return allOk ? 'pass' : 'fail'
    }
    return 'unknown'
  })()

  return (
    <div className="min-h-screen bg-navy-950 text-white">
      {/* 상단 헤더 */}
      <header className="border-b border-white/5 bg-navy-900/80 backdrop-blur-xl px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center gap-6">
          <Brand size="sm" />
          <span className="hidden md:inline-flex text-xs text-white/40 border-l border-white/10 pl-4">
            배치 결과 확인
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => router.push('/editor')}
              className="btn-ghost text-sm flex items-center gap-1.5"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              에디터로 돌아가기
            </button>
            <Link href="/projects" className="btn-ghost text-sm">
              프로젝트 목록
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        {!hasAnyData && (
          <div className="card p-8 text-center">
            <div className="w-14 h-14 rounded-full bg-amber-500/10 flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold mb-1">표시할 배치 결과가 없습니다</h2>
            <p className="text-sm text-white/60 mb-5">
              에디터에서 도면 업로드 → 배치 → 규정 검토까지 완료한 뒤 ‘결과 확인’ 버튼을 눌러주세요.
            </p>
            <button onClick={() => router.push('/editor')} className="btn-primary text-sm">
              에디터로 이동
            </button>
          </div>
        )}

        {hasAnyData && (
          <>
            <MetaBar
              projectName={projectName}
              address={workArea?.address || workArea?.displayName || '주소 미지정'}
              coordinate={fmtCoord(lon, lat)}
              capturedAt={fmtDate(resultSnapshot.capturedAt)}
            />

            {/* 종합 판정 */}
            <div className="flex items-center justify-between card px-6 py-4">
              <div>
                <div className="text-xs text-white/40 uppercase tracking-wider mb-1">종합 판정</div>
                <div className="text-lg font-semibold text-white">
                  {overallStatus === 'pass' && '모든 규정 기준을 충족했습니다'}
                  {overallStatus === 'fail' && '일부 규정을 충족하지 못했습니다'}
                  {overallStatus === 'unknown' && '규정 검토 결과가 없습니다'}
                </div>
              </div>
              <span
                className={`text-sm px-3 py-1.5 rounded-lg border ${STATUS_STYLES[overallStatus].badge}`}
              >
                {STATUS_STYLES[overallStatus].label}
              </span>
            </div>

            {/* 배치도 / 조감도 */}
            <section className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <DiagramCard
                title="배치도"
                subtitle="Cesium 뷰포트 탑다운 캡처"
                imageSrc={resultSnapshot.sitePlan}
                placeholderLabel="배치도 이미지가 없습니다"
                placeholderHint="에디터에서 '결과 확인' 버튼을 눌러 현재 뷰포트를 캡처해 주세요."
                badge="캡처 이미지"
              />
              <DiagramCard
                title="조감도"
                subtitle="AI 이미지 생성 (STAGE 6)"
                imageSrc={resultSnapshot.aerialView}
                placeholderLabel="AI 조감도 생성 대기 중"
                placeholderHint="학교 제공 GPT 이미지 생성 API 가 연결되면 배치도를 입력으로 받아 자동 생성됩니다."
                badge="AI 생성 예정"
              />
            </section>

            {/* 규정 요약 카드 */}
            <section>
              <h2 className="text-base font-semibold text-white mb-3">규정 검토 요약</h2>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <SummaryCard
                  label="건폐율"
                  value={fmt(cov?.value, '%')}
                  limit={fmt(cov?.limit, '%')}
                  status={statusFromRaw(cov?.status)}
                />
                <SummaryCard
                  label="이격거리"
                  value={fmt(setback?.min_distance_m, ' m')}
                  limit={`${fmt(setback?.required_m, ' m')} 이상`}
                  status={statusFromRaw(setback?.status)}
                />
                <SummaryCard
                  label="건물 높이"
                  value={fmt(height?.value_m, ' m', 1)}
                  limit={`${fmt(height?.limit_m, ' m', 1)} 이하`}
                  status={statusFromRaw(height?.status)}
                />
                <SummaryCard
                  label="층수 / 매스"
                  value={
                    building?.floors != null
                      ? `${building.floors}층`
                      : '—'
                  }
                  limit={
                    building?.footprint
                      ? `바닥 ${building.footprint.length}점`
                      : '바닥 정보 없음'
                  }
                  status="unknown"
                />
              </div>
            </section>

            {/* 위반 사항 */}
            <section>
              <h2 className="text-base font-semibold text-white mb-3">위반 사항</h2>
              {violations && violations.length > 0 ? (
                <ul className="space-y-2">
                  {violations.map((vio, idx) => (
                    <li
                      key={`${vio.code}-${idx}`}
                      className="card px-4 py-3 flex items-start gap-3"
                    >
                      <div className="mt-0.5 w-6 h-6 rounded-full bg-red-500/15 text-red-300 flex items-center justify-center flex-shrink-0">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-mono text-red-300/80 mb-0.5">
                          {vio.code}
                        </div>
                        <div className="text-sm text-white/80">{vio.message}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="card px-4 py-6 text-center">
                  <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto mb-2">
                    <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <div className="text-sm text-white/70">감지된 위반 사항이 없습니다</div>
                </div>
              )}
            </section>

            {/* AI 종합 스코어링 */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-base font-semibold text-white">AI 종합 스코어링</h2>
                <button
                  onClick={handleAIScoring}
                  disabled={aiScore.isLoading}
                  className="btn-primary text-sm flex items-center gap-2 disabled:opacity-50"
                >
                  {aiScore.isLoading ? (
                    <>
                      <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      분석 중...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      {aiScore.result ? 'AI 재평가' : 'AI 스코어링 실행'}
                    </>
                  )}
                </button>
              </div>

              {aiScore.error && !aiScore.result && (
                <div className="card px-4 py-3 border border-red-500/30 text-sm text-red-300">
                  {aiScore.error}
                </div>
              )}

              {!aiScore.result && !aiScore.isLoading && !aiScore.error && (
                <div className="card px-4 py-8 text-center">
                  <div className="w-12 h-12 rounded-full bg-brand-500/10 flex items-center justify-center mx-auto mb-3">
                    <svg className="w-6 h-6 text-brand-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                  <div className="text-sm text-white/70 mb-1">AI 스코어링으로 배치를 종합 평가합니다</div>
                  <div className="text-xs text-white/40">배치검토 · 주차 · 일조 결과를 LLM이 분석하여 항목별 등급과 개선점을 제안합니다</div>
                </div>
              )}

              {aiScore.result && (
                <div className="space-y-4">
                  {/* 종합 점수 + 등급 그리드 */}
                  <div className="card p-5">
                    <div className="flex items-center gap-6 mb-5">
                      {/* 원형 점수 */}
                      <div className="relative w-24 h-24 flex-shrink-0">
                        <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                          <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="8" />
                          <circle
                            cx="50" cy="50" r="42" fill="none"
                            stroke={aiScore.result.overallScore >= 80 ? '#10b981' : aiScore.result.overallScore >= 60 ? '#f59e0b' : '#ef4444'}
                            strokeWidth="8"
                            strokeLinecap="round"
                            strokeDasharray={`${aiScore.result.overallScore * 2.64} 264`}
                          />
                        </svg>
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                          <span className="text-2xl font-bold text-white">{aiScore.result.overallScore}</span>
                          <span className="text-[10px] text-white/40">/ 100</span>
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-white/80 leading-relaxed">{aiScore.result.summary}</div>
                        {aiScore.result.source === 'fallback' && (
                          <div className="text-xs text-amber-400/80 mt-2">⚡ LLM 서버 연결 실패 — 규칙 기반 간이 평가</div>
                        )}
                      </div>
                    </div>

                    {/* 항목별 등급 */}
                    <div className="grid grid-cols-5 gap-3">
                      {Object.entries(aiScore.result.categoryGrades).map(([cat, grade]) => {
                        const gradeColors: Record<string, string> = {
                          A: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
                          B: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
                          C: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
                          D: 'bg-orange-500/20 text-orange-300 border-orange-500/40',
                          E: 'bg-red-500/20 text-red-300 border-red-500/40',
                          F: 'bg-red-700/20 text-red-400 border-red-700/40',
                          N: 'bg-white/5 text-white/40 border-white/10',
                        }
                        return (
                          <div key={cat} className="text-center">
                            <div className={`text-2xl font-bold rounded-lg border py-2 mb-1.5 ${gradeColors[grade] || gradeColors.N}`}>
                              {grade}
                            </div>
                            <div className="text-xs text-white/50">{cat}</div>
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  {/* 개선 제안 */}
                  {aiScore.result.suggestions && (
                    <div className="card p-4">
                      <div className="text-xs text-white/40 uppercase tracking-wider mb-2">개선 제안</div>
                      <div className="text-sm text-white/80 leading-relaxed whitespace-pre-line">
                        {aiScore.result.suggestions}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>

            <div className="pt-4 pb-2 text-center">
              <p className="text-xs text-white/40">
                ※ 본 결과는 Building Cesium 자동 검토 결과이며, 최종 인허가는 관할 지자체 및 건축사 확인을 통해 진행해야 합니다.
              </p>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
