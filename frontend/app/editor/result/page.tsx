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
import { useCallback, useEffect, useMemo, useState } from 'react'
import Brand from '@/components/Brand'
import Lightbox from '@/components/Lightbox'
import ThemeToggle from '@/components/ThemeToggle'
import { useProjectStore, PlacementPlan } from '@/store/projectStore'
import { requestAIScoring } from '@/lib/analysisApi'
import { calculatePolygonArea } from '@/lib/geometry'
import { calculateVariantScore } from '@/lib/scoringEngine'
import { fetchLatestReviewResult } from '@/lib/api'
import { loadRegulationsFromServer, getZoneLimits, type ZoneType } from '@/lib/setbackTable'

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
  isDark = true,
}: {
  projectName: string
  address: string
  coordinate: string
  capturedAt: string
  isDark?: boolean
}) {
  return (
    <div className={`px-6 py-4 flex flex-wrap items-center gap-x-10 gap-y-3 rounded-xl ${isDark ? 'bg-white/5 border border-white/10' : 'bg-navy-850 border border-gray-200 shadow-sm'}`}>
      <div>
        <div className={`text-xs uppercase tracking-wider mb-0.5 ${isDark ? 'text-white/40' : 'text-gray-400'}`}>프로젝트</div>
        <div className={`text-base font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>{projectName}</div>
      </div>
      <div className={`border-l pl-10 ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
        <div className={`text-xs uppercase tracking-wider mb-0.5 ${isDark ? 'text-white/40' : 'text-gray-400'}`}>주소</div>
        <div className={`text-sm ${isDark ? 'text-white/80' : 'text-gray-700'}`}>{address}</div>
      </div>
      <div className={`border-l pl-10 ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
        <div className={`text-xs uppercase tracking-wider mb-0.5 ${isDark ? 'text-white/40' : 'text-gray-400'}`}>중심 좌표</div>
        <div className={`text-sm font-mono ${isDark ? 'text-white/80' : 'text-gray-700'}`}>{coordinate}</div>
      </div>
      <div className={`border-l pl-10 ml-auto ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
        <div className={`text-xs uppercase tracking-wider mb-0.5 ${isDark ? 'text-white/40' : 'text-gray-400'}`}>캡처 시각</div>
        <div className={`text-sm ${isDark ? 'text-white/80' : 'text-gray-700'}`}>{capturedAt}</div>
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
  onClick,
  isDark = true,
}: {
  title: string
  subtitle: string
  imageSrc: string | null
  placeholderLabel: string
  placeholderHint: string
  badge?: string
  onClick?: () => void
  isDark?: boolean
}) {
  return (
    <div className={`overflow-hidden flex flex-col rounded-xl ${isDark ? 'bg-white/5 border border-white/10' : 'bg-navy-850 border border-gray-200 shadow-sm'}`}>
      <div className={`px-5 py-4 flex items-center justify-between border-b ${isDark ? 'border-white/5' : 'border-gray-100'}`}>
        <div>
          <div className="flex items-center gap-2">
            <h3 className={`text-base font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>{title}</h3>
            {badge && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded border ${isDark ? 'bg-brand-500/15 text-brand-200 border-brand-500/20' : 'bg-blue-50 text-blue-600 border-blue-200'}`}>
                {badge}
              </span>
            )}
          </div>
          <p className={`text-xs mt-0.5 ${isDark ? 'text-white/40' : 'text-gray-400'}`}>{subtitle}</p>
        </div>
        {imageSrc && onClick && (
          <button
            onClick={onClick}
            className={`p-1.5 rounded-md transition-colors ${isDark ? 'hover:bg-white/10 text-white/50 hover:text-white/80' : 'hover:bg-gray-100 text-gray-400 hover:text-gray-600'}`}
            title="크게 보기"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
            </svg>
          </button>
        )}
      </div>
      <div
        className={`relative aspect-[16/10] flex items-center justify-center ${isDark ? 'bg-navy-950' : 'bg-gray-100'} ${
          imageSrc && onClick ? 'cursor-pointer group' : ''
        }`}
        onClick={imageSrc && onClick ? onClick : undefined}
      >
        {imageSrc ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageSrc}
              alt={title}
              className="absolute inset-0 w-full h-full object-cover transition-transform group-hover:scale-[1.02]"
            />
            {/* 호버 시 확대 아이콘 오버레이 */}
            {onClick && (
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-black/50 rounded-full p-3">
                  <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
                  </svg>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="text-center px-8">
            <div className={`w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3 ${isDark ? 'bg-white/5' : 'bg-gray-200'}`}>
              <svg className={`w-7 h-7 ${isDark ? 'text-white/30' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <div className={`text-sm font-medium mb-1 ${isDark ? 'text-white/70' : 'text-gray-600'}`}>{placeholderLabel}</div>
            <div className={`text-xs max-w-xs ${isDark ? 'text-white/40' : 'text-gray-400'}`}>{placeholderHint}</div>
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
  isDark = true,
}: {
  label: string
  value: string
  limit: string
  status: StatusKey
  isDark?: boolean
}) {
  const s = STATUS_STYLES[status]
  return (
    <div className={`p-4 ring-1 rounded-xl ${s.ring} ${isDark ? 'bg-white/5' : 'bg-navy-850 shadow-sm'}`}>
      <div className="flex items-start justify-between mb-3">
        <div className={`text-sm ${isDark ? 'text-white/60' : 'text-gray-500'}`}>{label}</div>
        <span className={`text-[11px] px-2 py-0.5 rounded border ${s.badge}`}>
          {s.label}
        </span>
      </div>
      <div className={`text-2xl font-semibold tabular-nums ${isDark ? 'text-white' : 'text-gray-900'}`}>{value}</div>
      <div className={`text-xs mt-1 ${isDark ? 'text-white/40' : 'text-gray-400'}`}>기준 {limit}</div>
    </div>
  )
}

// ─── 메인 페이지 ─────────────────────────────────────────
export default function ResultPage() {
  const router = useRouter()
  const { workArea, site, building, validation, reviewData, resultSnapshot, modelTransform, parkingZone, parkingConfig, sunlightAnalysisState, aiScore, setAIScore, setResultSnapshot, projectId, setValidation, generatedMasses, parkingPath, loadedMassGlbUrl, activePlanId, placementPlans, saveActivePlan, theme } =
    useProjectStore()

  // 선호도 체크박스 상태
  const [preferences, setPreferences] = useState({
    parkingFitness: false,
    southFacing: false,
    layoutAppropriateness: false,
  })

  // 페이지 진입 시 서버에서 최신 규정 기준값 로드
  // (관리자가 /admin/regulations 에서 변경한 값을 즉시 반영하기 위함)
  useEffect(() => {
    loadRegulationsFromServer()
  }, [])

  // 용도지역: 검토 탭에서 선택한 값 또는 자동 탐지된 값
  const selectedZoneType = reviewData?.selectedZoneType || validation?.zone_type || '미지정'

  // 선택된 용도지역의 규정 한도
  const selectedZoneLimits = useMemo(() => {
    return getZoneLimits(selectedZoneType as ZoneType)
  }, [selectedZoneType])

  // 새로고침으로 store 가 비어있을 때 — DB 의 가장 최근 검토 결과로 hydrate.
  // 단, 배치안(activePlanId)이 설정된 상태에선 hydration 건너뜀.
  // DB는 프로젝트 단위로만 저장되어 다른 배치안에서 검토했던 stale 결과가
  // 현재 배치안 결과처럼 보이는 문제를 막기 위함. 배치안 전환 후엔 사용자가
  // 명시적으로 새 검토를 실행하기 전까지 "미검토" 상태 유지.
  const [dbHydrated, setDbHydrated] = useState(false)
  useEffect(() => {
    if (!projectId) return
    if (validation || reviewData?.buildingCoverage) return // 이미 store 에 있음
    if (dbHydrated) return
    if (activePlanId) return // 배치안 활성 상태에선 stale DB 결과로 채우지 않음
    setDbHydrated(true)
    ;(async () => {
      const saved = await fetchLatestReviewResult(projectId)
      if (saved) {
        // 백엔드 응답 → store ValidationResult 로 hydrate
        setValidation({
          is_valid: saved.is_valid,
          building_coverage: saved.building_coverage as any,
          setback: saved.setback as any,
          height_check: saved.height_check as any,
          violations: saved.violations as any,
          zone_type: saved.zone_type ?? undefined,
        } as any)
      }
    })()
  }, [projectId, validation, reviewData, dbHydrated, setValidation, activePlanId])

  // 데이터가 아예 없으면 에디터로 유도
  const hasAnyData = validation || reviewData?.buildingCoverage || site || building || resultSnapshot.sitePlan

  // ─── 결과 페이지 PNG 다운로드 ─────────────
  const [isDownloading, setIsDownloading] = useState(false)
  const handleDownloadImage = useCallback(async () => {
    if (typeof window === 'undefined') return
    setIsDownloading(true)
    try {
      const html2canvas = (await import('html2canvas')).default
      const target = document.getElementById('result-capture-target')
      if (!target) throw new Error('캡처 대상이 없습니다')
      // 테마에 따른 배경색 설정
      const bgColor = theme === 'dark' ? '#0a1224' : '#f9fafb'
      const canvas = await html2canvas(target, {
        backgroundColor: bgColor,
        scale: 2,
        useCORS: true,
        logging: false,
        windowWidth: target.scrollWidth,
        windowHeight: target.scrollHeight,
      })
      const dataUrl = canvas.toDataURL('image/png')
      const a = document.createElement('a')
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      a.href = dataUrl
      a.download = `검토결과_${stamp}.png`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    } catch (e: any) {
      alert(`이미지 다운로드 실패: ${e?.message || e}`)
    } finally {
      setIsDownloading(false)
    }
  }, [theme])

  // ─── AI 렌더링 (Gemini / Nano Banana) ─────────────
  const [isRendering, setIsRendering] = useState(false)
  const [renderError, setRenderError] = useState<string | null>(null)
  // 렌더링 결과는 store에 저장하여 페이지 이동 후에도 유지
  // rendered* 는 사용자가 '초기화' 누를 때까지 그대로 유지. 매스를 바꿔
  // 새 캡처가 들어와도 옛 렌더가 우선 표시되도록 단순 fallback 만 사용.
  const renderedSitePlan = resultSnapshot.renderedSitePlan
  const renderedAerialView = resultSnapshot.renderedAerialView
  const setRenderedSitePlan = (url: string) => setResultSnapshot({ renderedSitePlan: url })
  const setRenderedAerialView = (url: string) => setResultSnapshot({ renderedAerialView: url })

  // ─── 이미지 라이트박스 ─────────────
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState(0) // 0: sitePlan, 1: aerialView

  // 라이트박스용 이미지 목록
  const lightboxImages = useMemo(() => {
    const images: { src: string; title: string }[] = []
    const sitePlanSrc = renderedSitePlan ?? resultSnapshot.sitePlan
    const aerialViewSrc = renderedAerialView ?? resultSnapshot.aerialView
    if (sitePlanSrc) images.push({ src: sitePlanSrc, title: '배치도' })
    if (aerialViewSrc) images.push({ src: aerialViewSrc, title: '조감도' })
    return images
  }, [renderedSitePlan, renderedAerialView, resultSnapshot.sitePlan, resultSnapshot.aerialView])

  const openLightbox = useCallback((index: number) => {
    setLightboxIndex(index)
    setLightboxOpen(true)
  }, [])

  const closeLightbox = useCallback(() => {
    setLightboxOpen(false)
  }, [])

  const prevLightbox = useCallback(() => {
    setLightboxIndex((i) => Math.max(0, i - 1))
  }, [])

  const nextLightbox = useCallback(() => {
    setLightboxIndex((i) => Math.min(lightboxImages.length - 1, i + 1))
  }, [])

  const handleAIRender = useCallback(async () => {
    if (!resultSnapshot.sitePlan && !resultSnapshot.aerialView) {
      setRenderError('렌더링할 캡처 이미지가 없습니다. 에디터에서 "결과 확인"을 먼저 눌러주세요.')
      return
    }
    setIsRendering(true)
    setRenderError(null)

    // 순차 호출 — 무료 티어 분당 호출 한도(429) 회피.
    // 둘 중 하나가 실패해도 다른 하나는 시도하고, 사용자에게는 묶어서 안내.
    const renderOne = async (
      image: string,
      kind: 'sitePlan' | 'aerialView',
    ): Promise<{ ok: true; url: string } | { ok: false; error: string }> => {
      try {
        const r = await fetch('/api/ai-render-gemini', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image, kind }),
        })
        const d = await r.json()
        if (!r.ok || !d.imageDataUrl) {
          return { ok: false, error: d.error || `${kind} 렌더 실패` }
        }
        return { ok: true, url: d.imageDataUrl }
      } catch (e: any) {
        return { ok: false, error: e?.message || `${kind} 호출 실패` }
      }
    }

    const errors: string[] = []
    if (resultSnapshot.sitePlan) {
      const res = await renderOne(resultSnapshot.sitePlan, 'sitePlan')
      if (res.ok) setRenderedSitePlan(res.url)
      else errors.push(`배치도: ${res.error}`)
    }
    if (resultSnapshot.aerialView) {
      const res = await renderOne(resultSnapshot.aerialView, 'aerialView')
      if (res.ok) setRenderedAerialView(res.url)
      else errors.push(`조감도: ${res.error}`)
    }

    if (errors.length > 0) {
      setRenderError(errors.join(' / '))
    }
    setIsRendering(false)
  }, [resultSnapshot])

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

  // ─── 배치안 분석 결과 계산 ─────────────────────────────
  const scoringInputData = useMemo(() => {
    // 1. 일조량 분석 결과
    const sunlight = sunlightAnalysisState?.result ? {
      avgHours: sunlightAnalysisState.result.averageSunlightHours,
      minHours: sunlightAnalysisState.result.minSunlightHours,
      maxHours: sunlightAnalysisState.result.maxSunlightHours,
      totalPoints: sunlightAnalysisState.result.totalPoints,
      hasData: true,
    } : { avgHours: 0, minHours: 0, maxHours: 0, totalPoints: 0, hasData: false }

    // 2. 유효 면적 계산 (대지 - 주차영역 - 통로)
    const siteArea = reviewData?.buildingCoverage?.siteArea ?? site?.area ?? 0
    const parkingArea = parkingZone?.totalAreaM2 ?? 0

    // 통로(aisle) 면적 계산
    let pathArea = 0
    if (parkingZone?.aisles) {
      for (const aisle of parkingZone.aisles) {
        if (aisle.polygon && aisle.polygon.length >= 3) {
          pathArea += calculatePolygonArea(aisle.polygon)
        }
      }
    }
    // 주차 경로 면적 (parkingPath)
    if (parkingPath?.points && parkingPath.points.length >= 2) {
      // 경로는 폴리라인이므로 폭(약 3m)을 가정하여 면적 계산
      const pathWidth = (parkingPath as any).vehicleWidth ?? 3 // m
      // parkingPath.length 가 이미 계산된 경로 길이
      pathArea += parkingPath.length * pathWidth
    }

    const effectiveArea = Math.max(0, siteArea - parkingArea - pathArea)

    // 3. 메인 창문 (외곽 창문) 남향 여부 계산
    let mainWindowFacesSouth = false
    let mainWindowDirection = 0
    let mainWindowDirectionLabel = ''
    let totalWindows = 0

    // 현재 로드된 매스 찾기 (CesiumViewer와 동일한 로직)
    const currentMass = loadedMassGlbUrl
      ? generatedMasses?.find(m => m.glbUrl === loadedMassGlbUrl || m.glbUrlNoRoof === loadedMassGlbUrl)
      : generatedMasses?.[0]
    const buildingRotation = modelTransform?.rotation ?? 0

    console.log('[결과 페이지] 창문 데이터 확인:', {
      loadedMassGlbUrl,
      generatedMassesCount: generatedMasses?.length ?? 0,
      currentMassId: currentMass?.id,
      openingsCount: currentMass?.openings?.length ?? 0,
    })

    if (currentMass?.openings) {
      const windows = currentMass.openings.filter(o => o.type === 'window')
      totalWindows = windows.length

      if (windows.length > 0) {
        // 외부를 향하는 창문만 필터링:
        // 매스 중심 → 창문 방향(방사선)과 창문선 사이의 각도가 90°에 가까우면 외부 향함
        const isExteriorFacing = (win: { x: number; y: number; rotation?: number }) => {
          const radialAngle = Math.atan2(win.y, win.x) * 180 / Math.PI
          const windowLineAngle = win.rotation || 0
          let angleDiff = Math.abs(radialAngle - windowLineAngle)
          angleDiff = angleDiff % 360
          if (angleDiff > 180) angleDiff = 360 - angleDiff
          return angleDiff >= 60 && angleDiff <= 120
        }
        const exteriorWindows = windows.filter(isExteriorFacing)

        // 외부 향하는 창문이 있으면 그 중에서, 없으면 전체 창문에서 선택
        const candidateWindows = exteriorWindows.length > 0 ? exteriorWindows : windows

        // 건물 중심에서 가장 먼 창문 찾기 (외곽 = 메인 창문)
        let maxDist = 0
        let mainWindow = candidateWindows[0]

        for (const win of candidateWindows) {
          const dist = Math.sqrt(win.x * win.x + win.y * win.y)
          if (dist > maxDist) {
            maxDist = dist
            mainWindow = win
          }
        }

        const radialAngle = Math.atan2(mainWindow.y, mainWindow.x) * 180 / Math.PI
        let angleDiff = Math.abs(radialAngle - (mainWindow.rotation || 0)) % 360
        if (angleDiff > 180) angleDiff = 360 - angleDiff
        console.log('[결과 페이지] 창문 필터:', { 전체: windows.length, 외부향: exteriorWindows.length, 방사선각도: radialAngle.toFixed(1), 창문선각도: mainWindow.rotation, 각도차: angleDiff.toFixed(1) })

        // 메인 창문의 절대 방향 계산
        // 창문이 바라보는 방향 = 건물 중심에서 창문까지의 방사선 방향
        // GLB 좌표 변환 적용: DXF(x,y) → GLB(-y, x)
        const glbX = -mainWindow.y
        const glbY = mainWindow.x

        // 건물 회전 적용하여 세계 좌표에서의 방향 계산
        const rotRad = buildingRotation * Math.PI / 180
        const cosR = Math.cos(rotRad)
        const sinR = Math.sin(rotRad)

        // 회전된 좌표 (건물 중심에서 창문까지의 벡터)
        const rotatedX = glbX * cosR - glbY * sinR
        const rotatedY = glbX * sinR + glbY * cosR

        // 수학적 각도 (0=동, 반시계 양수) → 나침반 방위 (0=북, 시계 양수)
        const mathAngle = Math.atan2(rotatedY, rotatedX) * 180 / Math.PI
        mainWindowDirection = (90 - mathAngle + 360) % 360

        console.log('[결과 페이지] 창문 방향 계산:', {
          dxfXY: [mainWindow.x.toFixed(2), mainWindow.y.toFixed(2)],
          glbXY: [glbX.toFixed(2), glbY.toFixed(2)],
          buildingRotation: buildingRotation.toFixed(1),
          rotatedXY: [rotatedX.toFixed(2), rotatedY.toFixed(2)],
          mathAngle: mathAngle.toFixed(1),
          compassDirection: mainWindowDirection.toFixed(1)
        })

        // 방향 라벨
        if (mainWindowDirection >= 315 || mainWindowDirection < 45) {
          mainWindowDirectionLabel = '북향'
        } else if (mainWindowDirection >= 45 && mainWindowDirection < 135) {
          mainWindowDirectionLabel = '동향'
        } else if (mainWindowDirection >= 135 && mainWindowDirection < 225) {
          mainWindowDirectionLabel = '남향'
          mainWindowFacesSouth = true
        } else {
          mainWindowDirectionLabel = '서향'
        }
      }
    }

    return {
      sunlight,
      effectiveArea,
      siteArea,
      parkingArea,
      pathArea,
      mainWindowFacesSouth,
      mainWindowDirection,
      mainWindowDirectionLabel,
      totalWindows,
    }
  }, [sunlightAnalysisState, reviewData, site, parkingZone, parkingPath, generatedMasses, modelTransform, loadedMassGlbUrl])

  // AI 스코어링 요청 - scoringEngine으로 점수 계산 후 LLM에서 요약/제안 생성
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
      // sunlightAnalysis 가 저장하는 averageSunlightHours 는 변수명과 달리
      // "2시간 간격 7스텝 중 일조 받은 스텝 수"(0~7) 이다. LLM/스코어링은
      // 실제 시간(0~14h) 단위로 받아야 임계값(10h 이상 우수 등)이 의미 있음.
      const SUNLIGHT_HOUR_STEP = 2
      const sunlightData = sunlightAnalysisState?.result ? {
        avg_sunlight_hours: sunlightAnalysisState.result.averageSunlightHours * SUNLIGHT_HOUR_STEP,
        min_sunlight_hours: sunlightAnalysisState.result.minSunlightHours * SUNLIGHT_HOUR_STEP,
        max_sunlight_hours: sunlightAnalysisState.result.maxSunlightHours * SUNLIGHT_HOUR_STEP,
        total_points: sunlightAnalysisState.result.totalPoints,
      } : null

      // validation 원본이 비어있어도 reviewData(검토 탭 결과)로 합성해
      // LLM 이 "데이터 누락" 으로 잘못 판단하는 것을 막는다.
      const composedValidation = {
        building_coverage: validation?.building_coverage ?? (reviewData?.buildingCoverage ? {
          value: reviewData.buildingCoverage.ratio,
          limit: reviewData.buildingCoverage.limit,
          status: reviewData.buildingCoverage.status === 'OK' ? 'OK' : 'fail',
          building_area: reviewData.buildingCoverage.buildingArea,
          site_area: reviewData.buildingCoverage.siteArea,
        } : null),
        setback: validation?.setback ?? (reviewData?.setback ? {
          min_distance_m: reviewData.setback.minDistance,
          required_m: reviewData.setback.required,
          status: reviewData.setback.status === 'OK' ? 'OK' : 'fail',
        } : null),
        height: validation?.height ?? (reviewData?.heightCheck ? {
          value_m: reviewData.heightCheck.value,
          limit_m: reviewData.heightCheck.limit,
          status: reviewData.heightCheck.status === 'OK' ? 'OK' : 'fail',
        } : (building?.height != null ? {
          value_m: building.height,
          limit_m: null,
          status: 'unknown',
        } : null)),
        violations: validation?.violations ?? [],
        is_valid: validation?.is_valid,
        zone_type: validation?.zone_type ?? reviewData?.selectedZoneType,
      }

      // scoringEngine으로 점수 계산 — averageSunlightHours 는 스텝 수 (0~7)
      // 라 ×2 환산. scoringEngine 의 임계값(10h 우수 / 3h 미달) 은 실시간 단위.
      const parkingDistance = parkingPath?.length ?? 50
      const baseSunlightHours = (sunlightAnalysisState?.result?.averageSunlightHours ?? 0) * SUNLIGHT_HOUR_STEP
      // 실제 각도 차이 사용 (정남향 180°에서 얼마나 벗어났는지)
      const angleFromSouth = Math.abs(scoringInputData.mainWindowDirection - 180)
      // 창문 방향에 따른 채광 보정 (남향 100%, 북향 50%)
      // 변별력 강화: 주변 건물 없을 때도 배치 방향에 따라 의미있는 점수 차이 발생
      const windowFactor = 1 - (angleFromSouth / 180) * 0.5
      const effectiveSunlightHours = baseSunlightHours * windowFactor

      // 배치 규정 점수 입력 — reviewData(현재 store) 기준
      const rv = reviewData
      const currentViolations = [
        rv?.buildingCoverage?.status === 'VIOLATION',
        rv?.setback?.status === 'VIOLATION',
        rv?.heightCheck?.status === 'VIOLATION',
      ].filter(Boolean).length
      const currentEffectiveRatio = scoringInputData.siteArea > 0
        ? scoringInputData.effectiveArea / scoringInputData.siteArea
        : 1

      const calculatedScores = calculateVariantScore({
        parkingDistance,
        sunlightHours: effectiveSunlightHours,
        angleFromSouth,
        violationCount: currentViolations,
        isOutOfBounds: rv?.isModelInBounds === false,
        effectiveAreaRatio: currentEffectiveRatio,
        preferences,
      })

      // LLM에서 요약/제안만 받아옴 — 합성된 validation 으로 누락 데이터 방지
      const res = await requestAIScoring(composedValidation, parkingData, sunlightData)

      setAIScore({
        isLoading: false,
        result: {
          categoryGrades: res.category_grades,
          overallScore: calculatedScores.overall,  // scoringEngine 점수 사용
          summary: res.summary,
          suggestions: res.suggestions,
          source: res.source,
          categories: calculatedScores.categories,  // 카테고리별 점수 저장
        },
        error: res.error || null,
      })

      // 현재 배치안에 스코어 저장
      saveActivePlan()
    } catch (e: any) {
      setAIScore({ isLoading: false, error: e.message || 'AI 스코어링 실패' })
    }
  }, [validation, reviewData, building, parkingZone, parkingConfig, sunlightAnalysisState, parkingPath, preferences, setAIScore, saveActivePlan, scoringInputData])

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
    // 변별 결과(도로변/인접대지 따로) — 결과 카드의 status 판정에 사용
    details: (reviewData.setback as any).details ?? [],
  } : null)

  // validation에 height 정보가 없으면 reviewData.heightCheck 사용, 그것도 없으면 building.height로 추정
  const height = validation?.height ?? (reviewData?.heightCheck ? {
    value_m: reviewData.heightCheck.value,
    limit_m: reviewData.heightCheck.limit,
    status: reviewData.heightCheck.status === 'OK' ? 'OK' : 'fail',
  } : building?.height != null ? {
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
    if (reviewData?.heightCheck?.status === 'VIOLATION') {
      v.push({
        code: 'HEIGHT_EXCEED',
        message: `건물 높이 ${reviewData.heightCheck.value.toFixed(1)}m 가 한도 ${reviewData.heightCheck.limit}m 를 초과합니다`,
      })
    }
    // isModelInBounds(건축선 안쪽 여부)는 setback 체크와 본질적으로 같은
    // 제약이라 별도 위반으로 카운트하지 않는다. 시각 피드백(에디터의 바운더리
    // 색상)에서만 활용.
    return v
  })()

  // 종합 status: validation 우선, 없으면 reviewData / violations 기반
  const overallStatus: StatusKey = (() => {
    if (validation?.is_valid === true) return 'pass'
    if (validation?.is_valid === false) return 'fail'
    if (violations.length > 0) return 'fail'
    if (reviewData?.buildingCoverage || reviewData?.setback || reviewData?.heightCheck) {
      // reviewData가 있고 위반사항이 없으면 적합
      const allOk =
        (!reviewData.buildingCoverage || reviewData.buildingCoverage.status === 'OK') &&
        (!reviewData.setback || reviewData.setback.status === 'OK') &&
        (!reviewData.heightCheck || reviewData.heightCheck.status === 'OK') &&
        reviewData.isModelInBounds !== false
      return allOk ? 'pass' : 'fail'
    }
    return 'unknown'
  })()

  // 메인 창문 방향 계산 헬퍼 함수
  const calculateWindowDirection = useCallback((massId: string | null, buildingRotation: number): number => {
    // 매스 찾기
    const mass = massId
      ? generatedMasses?.find(m => m.id === massId)
      : generatedMasses?.[0]

    if (!mass?.openings) return 180  // 창문 없으면 기본값 남향

    const windows = mass.openings.filter(o => o.type === 'window')
    if (windows.length === 0) return 180

    // 외부를 향하는 창문 필터링
    const isExteriorFacing = (win: { x: number; y: number; rotation?: number }) => {
      const radialAngle = Math.atan2(win.y, win.x) * 180 / Math.PI
      const windowLineAngle = win.rotation || 0
      let angleDiff = Math.abs(radialAngle - windowLineAngle) % 360
      if (angleDiff > 180) angleDiff = 360 - angleDiff
      return angleDiff >= 60 && angleDiff <= 120
    }
    const exteriorWindows = windows.filter(isExteriorFacing)
    const candidateWindows = exteriorWindows.length > 0 ? exteriorWindows : windows

    // 건물 중심에서 가장 먼 창문 찾기
    let maxDist = 0
    let mainWindow = candidateWindows[0]
    for (const win of candidateWindows) {
      const dist = Math.sqrt(win.x * win.x + win.y * win.y)
      if (dist > maxDist) {
        maxDist = dist
        mainWindow = win
      }
    }

    // GLB 좌표 변환 및 건물 회전 적용
    const glbX = -mainWindow.y
    const glbY = mainWindow.x
    const rotRad = buildingRotation * Math.PI / 180
    const rotatedX = glbX * Math.cos(rotRad) - glbY * Math.sin(rotRad)
    const rotatedY = glbX * Math.sin(rotRad) + glbY * Math.cos(rotRad)
    const mathAngle = Math.atan2(rotatedY, rotatedX) * 180 / Math.PI

    return (90 - mathAngle + 360) % 360
  }, [generatedMasses])

  // 배치안별 점수 계산 (실제 placementPlans 데이터 사용)
  const variantsData = useMemo(() => {
    // 일조량은 plan 별로 따로 가져감 — 활성 plan 은 store 의 현재 분석 결과
    // 우선, 그 다음 활성 plan 의 저장된 sunlightResult. 다른 plan 은 각자
    // 저장된 sunlightResult 우선, 없으면 활성 plan 의 일조로 폴백.
    // averageSunlightHours 는 스텝 수(0~7) 라 ×2 로 실제 시간 환산.
    const SUNLIGHT_HOUR_STEP = 2
    const activePlanObj = placementPlans.find(p => p.id === activePlanId)
    const activeSunlightSteps =
      sunlightAnalysisState?.result?.averageSunlightHours
        ?? activePlanObj?.sunlightResult?.averageSunlightHours
        ?? placementPlans.find(p => p.sunlightResult?.averageSunlightHours)?.sunlightResult?.averageSunlightHours
        ?? 0
    const getPlanBaseSunlight = (plan?: { sunlightResult?: { averageSunlightHours?: number } | null }) => {
      const steps = plan?.sunlightResult?.averageSunlightHours ?? activeSunlightSteps
      return steps * SUNLIGHT_HOUR_STEP
    }
    const activeBaseSunlight = activeSunlightSteps * SUNLIGHT_HOUR_STEP

    // 창문 방향에 따른 채광 보정 계수 계산 (plan 별 base 곱해서 사용)
    const applyWindowFactor = (base: number, angleFromSouth: number) => {
      const factor = 1 - (angleFromSouth / 180) * 0.5  // 0° → 1.0, 180° → 0.5
      return base * factor
    }

    // 배치 규정 점수 입력 계산 (위반 카운트 + 영역 이탈 + 유효면적 비율)
    const computeLayoutInputs = (rv: any, pZone: any, pPath: any, siteAreaOverride?: number) => {
      const violationCount = [
        rv?.buildingCoverage?.status === 'VIOLATION',
        rv?.setback?.status === 'VIOLATION',
        rv?.heightCheck?.status === 'VIOLATION',
      ].filter(Boolean).length
      const isOutOfBounds = rv?.isModelInBounds === false
      const siteArea = siteAreaOverride ?? rv?.buildingCoverage?.siteArea ?? 0
      const parkingArea = pZone?.totalAreaM2 ?? 0
      let pathArea = 0
      if (pZone?.aisles) {
        for (const aisle of pZone.aisles) {
          if (aisle?.polygon && aisle.polygon.length >= 3) {
            pathArea += calculatePolygonArea(aisle.polygon)
          }
        }
      }
      if (pPath?.points && pPath.points.length >= 2) {
        const pathWidth = (pPath as any).vehicleWidth ?? 3
        pathArea += pPath.length * pathWidth
      }
      const effectiveArea = Math.max(0, siteArea - parkingArea - pathArea)
      const effectiveAreaRatio = siteArea > 0 ? effectiveArea / siteArea : 1
      return { violationCount, isOutOfBounds, effectiveAreaRatio }
    }

    // 현재 활성 배치안의 점수 (scoringEngine 계산)
    const currentParkingDistance = parkingPath?.length ?? 50
    // 실제 각도 차이 사용 (정남향 180°에서 얼마나 벗어났는지)
    const currentAngleFromSouth = Math.abs(scoringInputData.mainWindowDirection - 180)
    // 창문 방향 보정된 일조량 (활성 plan base)
    const currentEffectiveSunlight = applyWindowFactor(activeBaseSunlight, currentAngleFromSouth)

    const currentLayoutInputs = computeLayoutInputs(
      reviewData,
      parkingZone,
      parkingPath,
      scoringInputData.siteArea,
    )
    const currentScores = calculateVariantScore({
      parkingDistance: currentParkingDistance,
      sunlightHours: currentEffectiveSunlight,
      angleFromSouth: currentAngleFromSouth,
      ...currentLayoutInputs,
      preferences,
    })

    // 현재 배치안 데이터 — 점수는 항상 scoringEngine 결과로 표시.
    // store.aiScore.result 는 활성 plan 이 바뀔 때 복원돼서, 그대로 사용하면
    // 다른 배치안과 동일한 점수가 표시되는 케이스가 있다 (createPlacementPlan
    // 이 직전 plan 의 점수를 복사해두면 발생).
    const currentPlan = placementPlans.find(p => p.id === activePlanId)
    const currentVariant = {
      id: activePlanId || 'current',
      name: currentPlan?.name || '현재',
      isCurrent: true,
      score: currentScores.overall,
      categories: currentScores.categories,
      angleFromSouth: currentAngleFromSouth,
    }

    // 다른 배치안들의 점수 — 진입할 때마다 항상 저장된 데이터(주차/방향/일조)
    // 로 재계산. plan.aiScore 가 잔존하더라도 무시. createPlacementPlan 이
    // 직전 plan 의 점수를 복사해두는 케이스 + 동일 store.aiScore 가 여러 plan
    // 사이에서 공유되는 케이스 모두 결과 페이지에선 항상 최신 데이터로 표시.
    const otherVariants = placementPlans
      .filter(p => p.id !== activePlanId)
      .map((plan) => {
        const planWindowDirection = calculateWindowDirection(plan.activeMassId, plan.modelTransform.rotation)
        const planAngleFromSouth = Math.abs(planWindowDirection - 180)
        const planParkingDistance = plan.parkingPath?.length ?? 50
        const planEffectiveSunlight = applyWindowFactor(getPlanBaseSunlight(plan), planAngleFromSouth)
        const planLayoutInputs = computeLayoutInputs(
          plan.reviewData,
          plan.parkingZone,
          plan.parkingPath,
        )

        const planScores = calculateVariantScore({
          parkingDistance: planParkingDistance,
          sunlightHours: planEffectiveSunlight,
          angleFromSouth: planAngleFromSouth,
          ...planLayoutInputs,
          preferences,
        })

        return {
          id: plan.id,
          name: plan.name,
          isCurrent: false,
          score: planScores.overall,
          categories: planScores.categories,
          angleFromSouth: planAngleFromSouth,
        }
      })

    return [currentVariant, ...otherVariants]
  }, [placementPlans, activePlanId, aiScore, parkingPath, parkingZone, reviewData, sunlightAnalysisState, scoringInputData, preferences, calculateWindowDirection])

  // 점수 순으로 정렬된 배치안
  const sortedVariants = useMemo(() => {
    return [...variantsData].sort((a, b) => b.score - a.score)
  }, [variantsData])

  // 1등 배치안
  const topVariant = sortedVariants[0]

  // 테마별 스타일 클래스
  const isDark = theme === 'dark'

  return (
    <div className={`min-h-screen transition-colors ${isDark ? 'bg-navy-950 text-white' : 'bg-gray-50 text-gray-900'}`}>
      {/* 상단 헤더 */}
      <header className={`border-b backdrop-blur-xl px-6 py-4 ${isDark ? 'border-white/5 bg-navy-900/80' : 'border-gray-200 bg-navy-900/80'}`}>
        <div className="max-w-7xl mx-auto flex items-center gap-6">
          <Brand size="sm" />
          <span className={`hidden md:inline-flex text-xs border-l pl-4 ${isDark ? 'text-white/40 border-white/10' : 'text-gray-400 border-gray-200'}`}>
            배치 결과 확인
          </span>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <button
              onClick={() => {
                // projectId 를 유지한 채로 에디터로 돌아가야 editor 페이지의
                // useEffect 가 setProjectId(null) 로 store 를 초기화하지 않음.
                const dest = projectId ? `/editor?projectId=${projectId}` : '/editor'
                router.push(dest)
              }}
              className={`text-sm flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors ${isDark ? 'text-white/70 hover:text-white hover:bg-white/10' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'}`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              에디터로 돌아가기
            </button>
            <Link href="/projects" className={`text-sm px-3 py-1.5 rounded-lg transition-colors ${isDark ? 'text-white/70 hover:text-white hover:bg-white/10' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'}`}>
              프로젝트 목록
            </Link>
            <button
              onClick={handleDownloadImage}
              disabled={isDownloading || !hasAnyData}
              className={`text-sm flex items-center gap-1.5 px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${isDark ? 'bg-brand-500 hover:bg-brand-600 text-white' : 'bg-brand-500 hover:bg-brand-600 text-white'}`}
              title="결과 페이지를 PNG 이미지로 다운로드"
            >
              {isDownloading ? (
                <>
                  <span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  생성 중…
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
                  </svg>
                  결과 리포트 저장
                </>
              )}
            </button>
          </div>
        </div>
      </header>

      <main id="result-capture-target" className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        {!hasAnyData && (
          <div className="card p-8 text-center">
            <div className="w-14 h-14 rounded-full bg-amber-500/10 flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h2 className={`text-lg font-semibold mb-1 ${isDark ? 'text-white' : 'text-gray-900'}`}>표시할 배치 결과가 없습니다</h2>
            <p className={`text-sm mb-5 ${isDark ? 'text-white/60' : 'text-gray-500'}`}>
              에디터에서 도면 업로드 → 배치 → 규정 검토까지 완료한 뒤 '결과 확인' 버튼을 눌러주세요.
            </p>
            <button
              onClick={() => {
                const dest = projectId ? `/editor?projectId=${projectId}` : '/editor'
                router.push(dest)
              }}
              className="btn-primary text-sm"
            >
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
              isDark={isDark}
            />

            {/* 종합 판정 */}
            <div className={`flex items-center justify-between px-6 py-4 rounded-xl ${isDark ? 'bg-white/5 border border-white/10' : 'bg-navy-850 border border-gray-200 shadow-sm'}`}>
              <div>
                <div className={`text-xs uppercase tracking-wider mb-1 ${isDark ? 'text-white/40' : 'text-gray-400'}`}>종합 판정</div>
                <div className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
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
                subtitle={renderedSitePlan ? 'Nano Banana 렌더링' : 'Cesium 뷰포트 탑다운 캡처'}
                imageSrc={renderedSitePlan ?? resultSnapshot.sitePlan}
                placeholderLabel="배치도 이미지가 없습니다"
                placeholderHint="에디터에서 '결과 확인' 버튼을 눌러 현재 뷰포트를 캡처해 주세요."
                badge={renderedSitePlan ? 'AI 렌더링' : '캡처 이미지'}
                onClick={() => openLightbox(0)}
                isDark={isDark}
              />
              <DiagramCard
                title="조감도"
                subtitle={renderedAerialView ? 'Nano Banana 렌더링' : 'Cesium 뷰포트 45° 캡처'}
                imageSrc={renderedAerialView ?? resultSnapshot.aerialView}
                placeholderLabel="조감도 이미지가 없습니다"
                placeholderHint="에디터에서 '결과 확인' 버튼을 눌러 현재 뷰포트를 캡처해 주세요."
                badge={renderedAerialView ? 'AI 렌더링' : '캡처 이미지'}
                onClick={() => openLightbox(lightboxImages.length > 1 ? 1 : 0)}
                isDark={isDark}
              />
            </section>

            {/* AI 렌더링 버튼 (GPT / Gemini 선택) */}
            <section className={`px-4 py-4 rounded-xl ${isDark ? 'bg-white/5 border border-white/10' : 'bg-navy-850 border border-gray-200 shadow-sm'}`}>
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <h3 className={`text-sm font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>AI 렌더링</h3>
                  <p className={`text-xs mt-0.5 ${isDark ? 'text-white/50' : 'text-gray-500'}`}>
                    캡처 이미지를 사실적인 건축 렌더링 스타일로 변환합니다.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {/* 뷰포트 초기화 버튼 */}
                  <button
                    onClick={() => {
                      setResultSnapshot({
                        sitePlan: null,
                        aerialView: null,
                        capturedAt: null,
                        captureSignature: null,
                        renderedSitePlan: null,
                        renderedAerialView: null,
                        renderedBasedOn: null,
                      })
                      setRenderError(null)
                    }}
                    disabled={isRendering || (!resultSnapshot.sitePlan && !resultSnapshot.aerialView)}
                    className={`px-3 py-2 rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center gap-1.5 ${isDark ? 'bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 hover:text-white' : 'bg-gray-100 border border-gray-200 text-gray-600 hover:bg-gray-200 hover:text-gray-800'}`}
                    title="캡처 이미지와 렌더링 결과를 초기화합니다. 에디터로 돌아가서 다시 결과 확인을 누르면 새로 캡처됩니다."
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    초기화
                  </button>
                  {/* AI 렌더링 버튼 */}
                  <button
                    onClick={handleAIRender}
                    disabled={isRendering || (!resultSnapshot.sitePlan && !resultSnapshot.aerialView)}
                    className={`px-4 py-2 rounded-lg font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center gap-2 ${isDark ? 'bg-white/10 border border-white/15 text-white hover:bg-white/15' : 'bg-brand-500 text-[#fff] hover:bg-brand-600'}`}
                  >
                    {isRendering ? (
                      <>
                        <span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                        렌더링 중...
                      </>
                    ) : (
                      <>AI 렌더링 실행</>
                    )}
                  </button>
                </div>
              </div>
              {renderError && (
                <div className="mt-3 px-3 py-2 rounded bg-red-500/10 border border-red-500/30 text-xs text-red-300">
                  {renderError}
                </div>
              )}
              {(renderedSitePlan || renderedAerialView) && !isRendering && !renderError && (
                <div className="mt-3 px-3 py-2 rounded bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300">
                  ✅ AI 렌더링 완료. 위 카드에서 확인하세요.
                </div>
              )}
            </section>

            {/* 규정 요약 카드 */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <h2 className={`text-base font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>규정 검토 요약</h2>
                {/* 적용 용도지역 표시 (검토 탭에서 선택한 값) */}
                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm ${isDark ? 'bg-white/5 border border-white/10' : 'bg-gray-100 border border-gray-200'}`}>
                  <span className={isDark ? 'text-white/50' : 'text-gray-500'}>적용규정:</span>
                  <span className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>{selectedZoneType}</span>
                </div>
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <SummaryCard
                  label="건폐율"
                  value={fmt(cov?.value, '%')}
                  limit={fmt(selectedZoneLimits.coverage, '%')}
                  status={
                    cov?.value != null && selectedZoneLimits.coverage != null
                      ? cov.value <= selectedZoneLimits.coverage ? 'pass' : 'fail'
                      : statusFromRaw(cov?.status)
                  }
                  isDark={isDark}
                />
                <SummaryCard
                  label="이격거리"
                  value={fmt(setback?.min_distance_m, ' m')}
                  limit={
                    selectedZoneLimits.setback_road !== selectedZoneLimits.setback_adjacent
                      ? `도로 ${fmt(selectedZoneLimits.setback_road, 'm')} · 인접 ${fmt(selectedZoneLimits.setback_adjacent, 'm')}`
                      : `${fmt(selectedZoneLimits.setback_road, ' m')} 이상`
                  }
                  status={
                    // 변별 검토 결과(details)가 있으면 변별로 판정 — 도로/인접 각자 기준
                    Array.isArray((setback as any)?.details) && (setback as any).details.length > 0
                      ? (setback as any).details.every((d: any) => d.status === 'OK') ? 'pass' : 'fail'
                      // 다음 우선: 검토 단계에서 이미 산출한 setback.status
                      : setback?.status === 'OK'
                        ? 'pass'
                        : setback?.status === 'fail' || setback?.status === 'VIOLATION'
                          ? 'fail'
                          // 마지막 폴백: 단일 도로변 기준으로 비교 (변별 정보가 전혀 없을 때만)
                          : setback?.min_distance_m != null && selectedZoneLimits.setback_road != null
                            ? setback.min_distance_m >= selectedZoneLimits.setback_road ? 'pass' : 'fail'
                            : statusFromRaw(setback?.status)
                  }
                  isDark={isDark}
                />
                <SummaryCard
                  label="건물 높이"
                  value={fmt(height?.value_m, ' m', 1)}
                  limit={selectedZoneLimits.height != null ? `${fmt(selectedZoneLimits.height, ' m', 1)} 이하` : '제한 없음'}
                  status={
                    height?.value_m != null && selectedZoneLimits.height != null
                      ? height.value_m <= selectedZoneLimits.height ? 'pass' : 'fail'
                      : 'pass'
                  }
                  isDark={isDark}
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
                  // 층수 검토는 임시 — 적합 표시
                  status="pass"
                  isDark={isDark}
                />
              </div>
            </section>

            {/* 위반 사항 */}
            <section>
              <h2 className={`text-base font-semibold mb-3 ${isDark ? 'text-white' : 'text-gray-900'}`}>위반 사항</h2>
              {violations && violations.length > 0 ? (
                <ul className="space-y-2">
                  {violations.map((vio, idx) => (
                    <li
                      key={`${vio.code}-${idx}`}
                      className={`px-4 py-3 flex items-start gap-3 rounded-xl ${isDark ? 'bg-white/5 border border-white/10' : 'bg-navy-850 border border-gray-200 shadow-sm'}`}
                    >
                      <div className="mt-0.5 w-6 h-6 rounded-full bg-red-500/15 text-red-300 flex items-center justify-center flex-shrink-0">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className={`text-xs font-mono mb-0.5 ${isDark ? 'text-red-300/80' : 'text-red-600'}`}>
                          {vio.code}
                        </div>
                        <div className={`text-sm ${isDark ? 'text-white/80' : 'text-gray-700'}`}>{vio.message}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className={`px-4 py-6 text-center rounded-xl ${isDark ? 'bg-white/5 border border-white/10' : 'bg-navy-850 border border-gray-200 shadow-sm'}`}>
                  <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto mb-2">
                    <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <div className={`text-sm ${isDark ? 'text-white/70' : 'text-gray-600'}`}>감지된 위반 사항이 없습니다</div>
                </div>
              )}
            </section>

            {/* 배치안 분석 결과 */}
            <section>
              <h2 className={`text-base font-semibold mb-3 ${isDark ? 'text-white' : 'text-gray-900'}`}>배치안 분석 결과</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* 일조량 분석 */}
                <div className={`p-4 rounded-xl ${isDark ? 'bg-white/5 border border-white/10' : 'bg-navy-850 border border-gray-200 shadow-sm'}`}>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center">
                      <svg className="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                      </svg>
                    </div>
                    <div className={`text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>일조량 분석</div>
                  </div>
                  {scoringInputData.sunlight.hasData ? (
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className={isDark ? 'text-white/60' : 'text-gray-500'}>평균 일조시간</span>
                        <span className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>{scoringInputData.sunlight.avgHours.toFixed(1)}시간</span>
                      </div>
                      <div className="flex justify-between">
                        <span className={isDark ? 'text-white/60' : 'text-gray-500'}>최소 / 최대</span>
                        <span className={isDark ? 'text-white/80' : 'text-gray-700'}>{scoringInputData.sunlight.minHours.toFixed(1)} ~ {scoringInputData.sunlight.maxHours.toFixed(1)}시간</span>
                      </div>
                      <div className="flex justify-between">
                        <span className={isDark ? 'text-white/60' : 'text-gray-500'}>측정 포인트</span>
                        <span className={isDark ? 'text-white/80' : 'text-gray-700'}>{scoringInputData.sunlight.totalPoints.toLocaleString()}개</span>
                      </div>
                    </div>
                  ) : (
                    <div className={`text-sm text-center py-3 ${isDark ? 'text-white/40' : 'text-gray-400'}`}>
                      일조 분석 미실행
                    </div>
                  )}
                </div>

                {/* 유효 면적 */}
                <div className={`p-4 rounded-xl ${isDark ? 'bg-white/5 border border-white/10' : 'bg-navy-850 border border-gray-200 shadow-sm'}`}>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-8 h-8 rounded-lg bg-blue-500/15 flex items-center justify-center">
                      <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
                      </svg>
                    </div>
                    <div className={`text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>유효 면적</div>
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className={isDark ? 'text-white/60' : 'text-gray-500'}>대지 면적</span>
                      <span className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>{scoringInputData.siteArea.toFixed(1)}㎡</span>
                    </div>
                    <div className="flex justify-between">
                      <span className={isDark ? 'text-white/60' : 'text-gray-500'}>주차 영역</span>
                      <span className="text-red-400">-{scoringInputData.parkingArea.toFixed(1)}㎡</span>
                    </div>
                    <div className="flex justify-between">
                      <span className={isDark ? 'text-white/60' : 'text-gray-500'}>통로 영역</span>
                      <span className="text-red-400">-{scoringInputData.pathArea.toFixed(1)}㎡</span>
                    </div>
                    <div className={`flex justify-between pt-2 border-t ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
                      <span className={`font-medium ${isDark ? 'text-white/80' : 'text-gray-700'}`}>유효 면적</span>
                      <span className="text-emerald-400 font-semibold">{scoringInputData.effectiveArea.toFixed(1)}㎡</span>
                    </div>
                  </div>
                </div>

                {/* 메인 창문 방향 */}
                <div className={`p-4 rounded-xl ${isDark ? 'bg-white/5 border border-white/10' : 'bg-navy-850 border border-gray-200 shadow-sm'}`}>
                  <div className="flex items-center gap-2 mb-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${scoringInputData.mainWindowFacesSouth ? 'bg-emerald-500/15' : 'bg-amber-500/15'}`}>
                      <svg className={`w-4 h-4 ${scoringInputData.mainWindowFacesSouth ? 'text-emerald-400' : 'text-amber-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                      </svg>
                    </div>
                    <div className={`text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>메인 창문 방향</div>
                  </div>
                  {scoringInputData.totalWindows > 0 ? (
                    <div className="space-y-3 text-sm">
                      <div className="flex justify-between items-center">
                        <span className={isDark ? 'text-white/60' : 'text-gray-500'}>전체 창문</span>
                        <span className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>{scoringInputData.totalWindows}개</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className={isDark ? 'text-white/60' : 'text-gray-500'}>메인 창문 방위</span>
                        <span className={isDark ? 'text-white/80' : 'text-gray-700'}>{scoringInputData.mainWindowDirection.toFixed(0)}°</span>
                      </div>
                      {/* 메인 창문 방향 표시 */}
                      <div className={`pt-3 border-t ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
                        <div className="flex items-center justify-center gap-3">
                          {/* 방위 나침반 */}
                          <div className="relative w-16 h-16">
                            <div className={`absolute inset-0 rounded-full border-2 ${isDark ? 'border-white/20' : 'border-gray-300'}`} />
                            <span className={`absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1 text-[10px] ${isDark ? 'text-white/40' : 'text-gray-400'}`}>N</span>
                            <span className={`absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1 text-[10px] ${isDark ? 'text-white/40' : 'text-gray-400'}`}>S</span>
                            <span className={`absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1 text-[10px] ${isDark ? 'text-white/40' : 'text-gray-400'}`}>W</span>
                            <span className={`absolute right-0 top-1/2 -translate-y-1/2 translate-x-1 text-[10px] ${isDark ? 'text-white/40' : 'text-gray-400'}`}>E</span>
                            {/* 방향 화살표 */}
                            <div
                              className="absolute inset-2 flex items-center justify-center"
                              style={{ transform: `rotate(${scoringInputData.mainWindowDirection}deg)` }}
                            >
                              <div className={`w-1 h-6 rounded-full ${scoringInputData.mainWindowFacesSouth ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                              <div
                                className={`absolute top-1 w-0 h-0 border-l-[4px] border-r-[4px] border-b-[6px] border-l-transparent border-r-transparent ${scoringInputData.mainWindowFacesSouth ? 'border-b-emerald-500' : 'border-b-amber-500'}`}
                              />
                            </div>
                          </div>
                          {/* 판정 */}
                          <div className="text-center">
                            <div className={`text-2xl font-bold ${scoringInputData.mainWindowFacesSouth ? 'text-emerald-400' : 'text-amber-400'}`}>
                              {scoringInputData.mainWindowDirectionLabel}
                            </div>
                            <div className={`text-xs mt-1 ${scoringInputData.mainWindowFacesSouth ? 'text-emerald-400/70' : 'text-amber-400/70'}`}>
                              {scoringInputData.mainWindowFacesSouth ? '✓ 남향 배치' : '남향 아님'}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className={`text-sm text-center py-3 ${isDark ? 'text-white/40' : 'text-gray-400'}`}>
                      창문 정보 없음
                    </div>
                  )}
                </div>
              </div>
            </section>

            {/* AI 종합 스코어링 - 배치안 비교 UI */}
            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className={`text-base font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>AI 종합 스코어링</h2>
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
                      {aiScore.result ? 'AI 재평가' : 'AI 재평가'}
                    </>
                  )}
                </button>
              </div>

              {aiScore.error && !aiScore.result && (
                <div className={`px-4 py-3 rounded-xl border text-sm ${isDark ? 'bg-white/5 border-red-500/30 text-red-300' : 'bg-red-50 border-red-200 text-red-600'}`}>
                  {aiScore.error}
                </div>
              )}

              {/* 메인 스코어링 카드 - 원형점수 + 테이블 + 체크박스 */}
              <div className="flex flex-col lg:flex-row gap-4">
                {/* 좌측: 원형 점수판 + 비교 테이블 */}
                <div className={`flex-1 p-6 flex flex-col md:flex-row items-center gap-8 rounded-xl ${isDark ? 'bg-white/5 border border-white/10' : 'bg-navy-850 border border-gray-200 shadow-sm'}`}>
                  {/* 원형 점수 */}
                  <div className="relative flex-shrink-0">
                    <div className="absolute -top-3 -left-3 w-12 h-12 rounded-full bg-brand-500 border-2 border-brand-300 flex items-center justify-center font-bold text-white text-sm shadow-lg z-10">
                      {topVariant?.name?.slice(0, 3) || 'A안'}
                    </div>
                    <div className="relative w-36 h-36 rounded-full bg-brand-500/10 border-4 border-brand-500/30 flex flex-col items-center justify-center">
                      <span className="text-xs text-brand-300 font-semibold mb-0.5 uppercase tracking-tight">SCORE</span>
                      <span className="text-5xl font-black text-brand-400">
                        {topVariant?.score ?? 0}
                      </span>
                    </div>
                  </div>

                  {/* 비교 테이블 */}
                  <div className="flex-1 w-full overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className={`text-xs text-brand-300 uppercase ${isDark ? 'bg-white/5 border-b border-white/10' : 'bg-gray-50 border-b border-gray-200'}`}>
                        <tr>
                          <th className="px-4 py-2.5 text-left font-semibold rounded-tl-lg">대안</th>
                          <th className="px-4 py-2.5 text-center font-semibold">총점</th>
                          <th className="px-4 py-2.5 text-center font-semibold">일조량</th>
                          <th className="px-4 py-2.5 text-center font-semibold">배치 규정</th>
                          <th className="px-4 py-2.5 text-center font-semibold rounded-tr-lg">주차 편의</th>
                        </tr>
                      </thead>
                      <tbody>
                        {variantsData.length > 0 ? variantsData.map((variant) => (
                          <tr
                            key={variant.id}
                            className={`${isDark ? 'border-b border-white/5' : 'border-b border-gray-100'} ${variant.isCurrent ? 'bg-brand-500/10' : ''}`}
                          >
                            <td className={`px-4 py-3 font-medium flex items-center gap-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>
                              {variant.isCurrent && <span className="w-2 h-2 rounded-full bg-brand-400" />}
                              {variant.name} {variant.isCurrent ? '(현재)' : ''}
                            </td>
                            <td className="px-4 py-3 text-center font-bold text-brand-300">
                              {variant.score}점
                            </td>
                            <td className={`px-4 py-3 text-center ${isDark ? 'text-white/70' : 'text-gray-600'}`}>
                              {variant.categories.sunlight}점
                            </td>
                            <td className={`px-4 py-3 text-center ${isDark ? 'text-white/70' : 'text-gray-600'}`}>
                              {variant.categories.layout}점
                            </td>
                            <td className={`px-4 py-3 text-center ${isDark ? 'text-white/70' : 'text-gray-600'}`}>
                              {variant.categories.parking}점
                            </td>
                          </tr>
                        )) : (
                          <tr>
                            <td colSpan={5} className={`px-4 py-6 text-center ${isDark ? 'text-white/40' : 'text-gray-400'}`}>
                              배치안이 없습니다. 먼저 배치안을 저장해주세요.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* 우측: 선호도 체크박스 */}
                <div className={`w-full lg:w-56 p-5 flex flex-col gap-4 rounded-xl ${isDark ? 'bg-brand-500/5 border border-brand-500/30' : 'bg-blue-50 border border-blue-200'}`}>
                  <div className={`text-xs font-semibold uppercase tracking-wider mb-1 ${isDark ? 'text-brand-300' : 'text-blue-600'}`}>선호도 가중치</div>
                  {[
                    { id: 'southFacing', label: '일조량' },
                    { id: 'layoutAppropriateness', label: '배치' },
                    { id: 'parkingFitness', label: '주차 편의' },
                  ].map((pref) => (
                    <label key={pref.id} className="flex items-center justify-between group cursor-pointer">
                      <span className={`text-sm flex items-center gap-2 ${isDark ? 'text-white/80 group-hover:text-white' : 'text-gray-700 group-hover:text-gray-900'}`}>
                        <span className="w-1.5 h-1.5 rounded-full bg-brand-400" />
                        {pref.label}
                      </span>
                      <input
                        type="checkbox"
                        className={`w-5 h-5 rounded text-brand-500 focus:ring-brand-500/50 cursor-pointer ${isDark ? 'border-white/20 bg-black/40' : 'border-gray-300 bg-navy-850'}`}
                        checked={preferences[pref.id as keyof typeof preferences] || false}
                        onChange={(e) => setPreferences(p => ({ ...p, [pref.id]: e.target.checked }))}
                      />
                    </label>
                  ))}
                </div>
              </div>

              {/* 제안 순위 섹션 */}
              <div className={`p-5 rounded-xl ${isDark ? 'bg-white/5 border border-white/10' : 'bg-navy-850 border border-gray-200 shadow-sm'}`}>
                <div className="flex flex-col md:flex-row items-center gap-4">
                  <div className={`font-bold text-lg italic shrink-0 ${isDark ? 'text-brand-300' : 'text-brand-600'}`}>
                    제안 순위
                  </div>
                  <div className="flex items-center justify-center flex-1 flex-wrap gap-3">
                    {sortedVariants.map((variant, index) => (
                      <div key={variant.id} className="flex items-center gap-3">
                        <div className={`px-5 py-2.5 border-2 font-semibold rounded-lg transition-all ${
                          index === 0
                            ? 'border-brand-500 bg-brand-500/20 text-brand-100 shadow-[0_0_12px_rgba(59,130,246,0.25)]'
                            : isDark
                              ? 'border-white/10 bg-white/5 text-white/50'
                              : 'border-gray-200 bg-gray-50 text-gray-500'
                        }`}>
                          {variant.name} ({variant.score}점)
                        </div>
                        {index < sortedVariants.length - 1 && (
                          <svg className={`w-5 h-5 ${isDark ? 'text-white/20' : 'text-gray-300'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 5l7 7-7 7" />
                          </svg>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
                {sortedVariants.length > 0 && (
                  <div className={`mt-4 pt-4 text-sm flex items-center gap-2 ${isDark ? 'border-t border-white/5' : 'border-t border-gray-100'}`}>
                    <span className={`font-medium ${isDark ? 'text-brand-300' : 'text-brand-600'}`}>○ 분석결과:</span>
                    <span className={isDark ? 'text-white/80' : 'text-gray-700'}>
                      현재 선호도 기준 최적의 대안은 <span className="text-brand-400 font-bold">{topVariant?.name}</span>이며, 종합 스코어는 <span className="text-brand-400 font-bold">{topVariant?.score}점</span>입니다.
                    </span>
                  </div>
                )}
              </div>

              {/* LLM 요약 (LLM 연결 성공 시에만 표시) */}
              {aiScore.result?.summary && aiScore.result.source === 'llm' && (
                <div className={`p-4 rounded-xl ${isDark ? 'bg-white/5 border border-white/10' : 'bg-navy-850 border border-gray-200 shadow-sm'}`}>
                  <div className={`text-xs uppercase tracking-wider mb-2 ${isDark ? 'text-white/40' : 'text-gray-400'}`}>AI 분석 요약</div>
                  <div className={`text-sm leading-relaxed ${isDark ? 'text-white/80' : 'text-gray-700'}`}>{aiScore.result.summary}</div>
                </div>
              )}

              {/* 개선 제안 (LLM 연결 성공 시에만 표시) */}
              {aiScore.result?.suggestions && aiScore.result.source === 'llm' && (
                <div className={`p-4 rounded-xl ${isDark ? 'bg-white/5 border border-white/10' : 'bg-navy-850 border border-gray-200 shadow-sm'}`}>
                  <div className={`text-xs uppercase tracking-wider mb-2 ${isDark ? 'text-white/40' : 'text-gray-400'}`}>개선 제안</div>
                  <div className={`text-sm leading-relaxed whitespace-pre-line ${isDark ? 'text-white/80' : 'text-gray-700'}`}>
                    {aiScore.result.suggestions}
                  </div>
                </div>
              )}
            </section>

            <div className="pt-4 pb-2 text-center">
              <p className={`text-xs ${isDark ? 'text-white/40' : 'text-gray-400'}`}>
                ※ 본 결과는 Building Cesium 자동 검토 결과이며, 최종 인허가는 관할 지자체 및 건축사 확인을 통해 진행해야 합니다.
              </p>
            </div>
          </>
        )}
      </main>

      {/* 이미지 라이트박스 */}
      <Lightbox
        isOpen={lightboxOpen}
        imageSrc={lightboxImages[lightboxIndex]?.src || null}
        title={lightboxImages[lightboxIndex]?.title}
        onClose={closeLightbox}
        onPrev={prevLightbox}
        onNext={nextLightbox}
        hasPrev={lightboxIndex > 0}
        hasNext={lightboxIndex < lightboxImages.length - 1}
      />
    </div>
  )
}
