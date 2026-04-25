'use client'

import { useState, useEffect, useCallback } from 'react'
import { useProjectStore } from '@/store/projectStore'
import {
  uploadDxf,
  listProjectDxfFiles,
  deleteDxfFile,
  SidebarDxfFile,
} from '@/lib/api'
import AnalysisModal, { AnalysisResult } from '@/components/AnalysisModal'
import ParkingZonePanel from '@/components/ParkingZonePanel'

/**
 * 사이드바 컴포넌트
 * - DXF 파일 업로드
 * - 매스 설정
 * - 규정 검토 결과
 */
export default function Sidebar() {
  const {
    site,
    building,
    validation,
    viewer,
    selectedModel,
    loadedModelEntity,
    modelTransform,
    workArea,
    availableModels,
    selectedBlockCount,
    selectedBlockInfo,
    isLoadingModel,
    humanScaleModelLoaded,
    generatedMasses,
    reviewData,
    sunlightAnalysisState,
    runReviewCheckFn,
    startSunlightFn,
    toggleSunlightHeatmapFn,
    clearSunlightFn,
    setSunlightHeatmapModeFn,
    sunlightDate,
    setSunlightDate,
    setSite,
    setBuilding,
    setValidation,
    setLoading,
    setError,
    setSelectedModel,
    setLoadedModelEntity,
    setModelTransform,
    setModelToLoad,
    setHumanScaleModelLoaded,
  } = useProjectStore()

  const [activeTab, setActiveTab] = useState<'upload' | 'mass' | 'validate' | 'parking'>('upload')
  const projectId = useProjectStore((s) => s.projectId)
  const [dxfList, setDxfList] = useState<SidebarDxfFile[]>([])
  const [dxfListLoading, setDxfListLoading] = useState(false)

  const refreshDxfList = useCallback(async () => {
    if (!projectId) {
      setDxfList([])
      return
    }
    setDxfListLoading(true)
    try {
      const list = await listProjectDxfFiles(projectId)
      setDxfList(list)
    } catch (e) {
      console.error('[Sidebar] DXF 목록 로드 실패', e)
    } finally {
      setDxfListLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    refreshDxfList()
  }, [refreshDxfList])

  const handleDeleteDxf = async (dxf: SidebarDxfFile) => {
    if (!confirm(`'${dxf.original_filename}' 도면을 삭제하시겠습니까?\n분류 결과와 생성된 3D 모델도 함께 삭제됩니다.`)) {
      return
    }
    try {
      await deleteDxfFile(dxf.id)
      await refreshDxfList()
      // 로컬 store에 같은 fileId가 있으면 함께 정리
      const masses = useProjectStore.getState().generatedMasses
      for (const m of masses) {
        if ((m as any).fileId === dxf.id) {
          useProjectStore.getState().removeGeneratedMass(m.id)
        }
      }
    } catch (e: any) {
      alert(e.message || '삭제 실패')
    }
  }
  // sunlightDate는 store에서 가져옴 (CesiumViewer와 공유)

  // Analysis modal state
  const [analysisFile, setAnalysisFile] = useState<File | null>(null)
  const [showAnalysisModal, setShowAnalysisModal] = useState(false)
  // 샘플 도면 fetch 진행 중인 파일명
  const [sampleLoading, setSampleLoading] = useState<string | null>(null)

  // 생성된 매스 모델을 선택하여 Cesium에 배치
  const handlePlaceMass = (mass: typeof generatedMasses[0]) => {
    if (selectedBlockCount === 0) {
      setError('먼저 영역 선택 버튼으로 블록을 선택해주세요.')
      return
    }
    if (!mass.glbUrl) {
      setError('GLB 모델 URL이 없습니다.')
      return
    }
    // building 정보 설정 후 매스 GLB 로드 트리거
    setBuilding({
      height: mass.height,
      floors: mass.floors,
      footprint: mass.footprint,
      position: mass.centroid,
    })
    setSite({
      fileId: mass.id,
      footprint: mass.footprint,
      area: mass.area,
      centroid: mass.centroid,
    })
    setTimeout(() => {
      useProjectStore.getState().setMassGlbToLoad(mass.glbUrl)
    }, 0)
  }

  // 3D 샘플 모델 로드 (스토어를 통해 CesiumViewer에서 처리)
  const handleLoadSampleModel = (filename: string) => {
    if (selectedBlockCount === 0) {
      setError('먼저 영역 선택 버튼으로 블록을 선택해주세요.')
      return
    }
    // 스토어에 로드할 모델 파일명 설정 → CesiumViewer에서 감지하여 로드
    setModelToLoad(filename)
  }

  // 로드된 모델 제거
  const handleRemoveModel = () => {
    if (loadedModelEntity && viewer) {
      viewer.entities.remove(loadedModelEntity)
      setLoadedModelEntity(null)
      setSelectedModel(null)
      setModelTransform({
        longitude: 127.1388,
        latitude: 37.4449,
        height: 0,
        rotation: 180,
      })
    }
  }

  // 모델 높이 조절
  const handleModelHeightChange = (newHeight: number) => {
    if (!loadedModelEntity || !viewer) return

    const Cesium = (window as any).Cesium
    if (!Cesium) return

    setModelTransform({ height: newHeight })

    // 새 위치로 업데이트
    loadedModelEntity.position = Cesium.Cartesian3.fromDegrees(
      modelTransform.longitude,
      modelTransform.latitude,
      newHeight
    )

    // 회전도 함께 적용
    const heading = Cesium.Math.toRadians(modelTransform.rotation)
    const hpr = new Cesium.HeadingPitchRoll(heading, 0, 0)
    loadedModelEntity.orientation = Cesium.Transforms.headingPitchRollQuaternion(
      Cesium.Cartesian3.fromDegrees(modelTransform.longitude, modelTransform.latitude, newHeight),
      hpr
    )

    viewer.scene.requestRender()
  }

  // 모델 회전 조절
  const handleModelRotationChange = (newRotation: number) => {
    if (!loadedModelEntity || !viewer) return

    const Cesium = (window as any).Cesium
    if (!Cesium) return

    setModelTransform({ rotation: newRotation })

    // 회전 업데이트 (Z축 기준)
    const heading = Cesium.Math.toRadians(newRotation)
    const hpr = new Cesium.HeadingPitchRoll(heading, 0, 0)
    loadedModelEntity.orientation = Cesium.Transforms.headingPitchRollQuaternion(
      Cesium.Cartesian3.fromDegrees(modelTransform.longitude, modelTransform.latitude, modelTransform.height),
      hpr
    )

    viewer.scene.requestRender()
  }

  // 모델 스케일 조절
  const handleModelScaleChange = (newScale: number) => {
    if (!loadedModelEntity || !viewer) return

    setModelTransform({ scale: newScale })

    // 스케일 업데이트
    if (loadedModelEntity.model) {
      loadedModelEntity.model.scale = newScale
    }

    viewer.scene.requestRender()
  }

  // DXF 파일 업로드
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Open analysis modal instead of directly uploading
    setAnalysisFile(file)
    setShowAnalysisModal(true)
  }

  // 샘플 도면 로드 — public/samples/ 의 DXF를 받아와서 업로드와 동일한 AnalysisModal
  // 파이프라인으로 통과시켜 시각화합니다. AI 서버가 연결되기 전에도 백엔드 mock
  // 분류기 + 실제 매스 생성을 거쳐 동일한 모달 UX를 체험할 수 있습니다.
  const handleLoadSampleDxf = async (filename: string, label: string) => {
    try {
      setSampleLoading(filename)
      setError(null)
      const res = await fetch(`/samples/${filename}`)
      if (!res.ok) {
        throw new Error(`샘플 파일을 불러오지 못했습니다 (${res.status})`)
      }
      const blob = await res.blob()
      const file = new File([blob], filename, { type: 'application/dxf' })
      setAnalysisFile(file)
      setShowAnalysisModal(true)
    } catch (e: any) {
      console.error('샘플 로드 실패:', e)
      setError(e?.message || '샘플 도면을 불러오지 못했습니다.')
    } finally {
      setSampleLoading(null)
    }
  }

  // Handle analysis modal completion — 생성된 매스를 목록에 추가 (즉시 배치 X)
  const handleAnalysisComplete = (result: AnalysisResult) => {
    if (result.projectId) {
      useProjectStore.getState().setProjectId(result.projectId)
      // URL에 projectId 반영 (새로고침 시에도 프로젝트 유지)
      const url = new URL(window.location.href)
      if (!url.searchParams.get('projectId')) {
        url.searchParams.set('projectId', result.projectId)
        const pName = useProjectStore.getState().projectName
        if (pName) url.searchParams.set('name', pName)
        window.history.replaceState({}, '', url.toString())
      }
    }

    // DXF 로컬 좌표를 위경도로 변환
    let footprint = result.site.footprint
    let centroid = result.site.centroid
    const bounds = result.site.bounds
    const anchor: [number, number] | null = selectedBlockInfo?.centroid
      ? selectedBlockInfo.centroid
      : workArea
        ? [workArea.longitude, workArea.latitude]
        : null

    // footprint이 너무 작으면 bounds 사각형으로 대체
    if (footprint.length >= 3 && bounds?.min_x != null) {
      const xs = footprint.map((c: number[]) => c[0])
      const ys = footprint.map((c: number[]) => c[1])
      const fpArea = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys))
      const bArea = (bounds.max_x - bounds.min_x) * (bounds.max_y - bounds.min_y)
      if (fpArea < bArea * 0.1 && bArea > 10) {
        footprint = [
          [bounds.min_x, bounds.min_y], [bounds.max_x, bounds.min_y],
          [bounds.max_x, bounds.max_y], [bounds.min_x, bounds.max_y],
        ]
        centroid = [(bounds.min_x + bounds.max_x) / 2, (bounds.min_y + bounds.max_y) / 2]
      }
    }

    // 위경도 판별 후 변환
    if (footprint.length > 0 && anchor) {
      const xs = footprint.map(c => c[0])
      const ys = footprint.map(c => c[1])
      const minX = Math.min(...xs), maxX = Math.max(...xs)
      const minY = Math.min(...ys), maxY = Math.max(...ys)
      const isLonLat = minX >= 124 && maxX <= 133 && minY >= 33 && maxY <= 39
        && (maxX - minX) < 0.05 && (maxY - minY) < 0.05

      if (!isLonLat) {
        const latRad = anchor[1] * Math.PI / 180
        const mPerDegLon = 111320 * Math.cos(latRad)
        const mPerDegLat = 111320
        const cx = xs.reduce((a, b) => a + b, 0) / xs.length
        const cy = ys.reduce((a, b) => a + b, 0) / ys.length
        footprint = footprint.map(([x, y]) => [
          anchor[0] + (x - cx) / mPerDegLon,
          anchor[1] + (y - cy) / mPerDegLat,
        ])
        centroid = [anchor[0], anchor[1]]
      }
    }

    // 생성된 매스 모델을 목록에 추가
    const glbUrl = result.glbUrl || ''
    const fileName = analysisFile?.name || 'unknown.dxf'

    useProjectStore.getState().addGeneratedMass({
      id: result.fileId || Date.now().toString(),
      fileName,
      label: fileName.replace(/\.dxf$/i, '').replace(/_/g, ' '),
      glbUrl,
      footprint,
      centroid,
      area: result.site.area_sqm,
      height: 9,
      floors: 3,
      classification: {
        total_entities: result.classification.total_entities,
        class_counts: result.classification.class_counts,
        average_confidence: result.classification.average_confidence,
      },
      boundingBox: result.boundingBox || undefined,
      createdAt: Date.now(),
    })

    // 모달 닫고 매스 탭으로
    setShowAnalysisModal(false)
    setAnalysisFile(null)
    setActiveTab('mass')
    setError(null)
    // 새 DXF가 DB에 추가됐으니 사이드바 목록도 새로고침
    refreshDxfList()
  }


  // 배치 검토 — CesiumViewer에서 runReviewCheckFn으로 처리

  return (
    <div className="sidebar">
      {/* 탭 네비게이션 */}
      <div className="flex border-b">
        <button
          onClick={() => setActiveTab('upload')}
          className={`flex-1 py-3 text-sm font-medium ${
            activeTab === 'upload'
              ? 'text-primary-600 border-b-2 border-primary-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          1. 업로드
        </button>
        <button
          onClick={() => setActiveTab('mass')}
          className={`flex-1 py-3 text-sm font-medium ${
            activeTab === 'mass'
              ? 'text-primary-600 border-b-2 border-primary-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          2. 매스
        </button>
        <button
          onClick={() => setActiveTab('parking')}
          className={`flex-1 py-3 text-sm font-medium ${
            activeTab === 'parking'
              ? 'text-primary-600 border-b-2 border-primary-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          3. 주차
        </button>
        <button
          onClick={() => setActiveTab('validate')}
          className={`flex-1 py-3 text-sm font-medium ${
            activeTab === 'validate'
              ? 'text-primary-600 border-b-2 border-primary-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          4. 검토
        </button>
      </div>

      {/* 탭 내용 */}
      <div className="p-4">
        {/* 업로드 탭 */}
        {activeTab === 'upload' && (
          <div className="space-y-4">
            <h3 className="font-semibold text-lg">DXF 파일 업로드</h3>
            <p className="text-sm text-gray-600">
              CAD 도면(DXF)을 업로드하여 대지 경계를 추출합니다.
            </p>

            <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
              <input
                type="file"
                accept=".dxf"
                onChange={handleFileUpload}
                className="hidden"
                id="dxf-upload"
              />
              <label
                htmlFor="dxf-upload"
                className="cursor-pointer flex flex-col items-center"
              >
                <svg
                  className="w-12 h-12 text-gray-400 mb-2"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                  />
                </svg>
                <span className="text-primary-600 font-medium">파일 선택</span>
                <span className="text-sm text-gray-500">또는 드래그 앤 드롭</span>
              </label>
            </div>

            {/* 샘플 도면 (실제 DXF로 분석 파이프라인 시연) */}
            <div className="border-t pt-4">
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-medium text-sm">샘플 도면으로 시연</h4>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 border border-blue-200">
                  AI 연결 전 데모
                </span>
              </div>
              <p className="text-xs text-gray-500 mb-3">
                DXF가 없으면 아래 샘플 도면으로 파싱 → 분류 → 3D 매스 생성 전체 과정을 확인할 수 있습니다.
              </p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { file: 'arquitectura.dxf', label: '건축 도면', sub: 'Arquitectura · 2.5MB' },
                  { file: 'trabajo_final.dxf', label: '종합 설계', sub: 'Trabajo Final · 1.5MB' },
                  { file: 'casa_velacion_1.dxf', label: '전기 설비 1', sub: 'Casa Velación · 540KB' },
                  { file: 'casa_velacion_2.dxf', label: '전기 설비 2', sub: 'Casa Velación · 734KB' },
                ].map((s) => {
                  const busy = sampleLoading === s.file
                  return (
                    <button
                      key={s.file}
                      onClick={() => handleLoadSampleDxf(s.file, s.label)}
                      disabled={!!sampleLoading}
                      className={`flex flex-col items-start gap-0.5 rounded-lg border p-2 text-left transition-colors ${
                        busy
                          ? 'border-purple-400 bg-purple-50 cursor-wait'
                          : sampleLoading
                          ? 'border-gray-200 bg-gray-50 opacity-50 cursor-not-allowed'
                          : 'border-gray-200 hover:border-purple-400 hover:bg-purple-50'
                      }`}
                    >
                      <span className="text-sm font-medium text-gray-800">
                        {s.label}
                        {busy && ' …'}
                      </span>
                      <span className="text-[11px] text-gray-500">{s.sub}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* 대지 정보 */}
            {site && (
              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="font-medium mb-2">대지 정보</h4>
                <div className="space-y-1 text-sm">
                  <p>면적: <span className="font-medium">{site.area?.toFixed(2)} m²</span></p>
                  <p>중심: [{site.centroid?.[0].toFixed(6)}, {site.centroid?.[1].toFixed(6)}]</p>
                </div>
              </div>
            )}

            {/* 선택된 블록 정보 */}
            {selectedBlockInfo && (
              <div className="bg-blue-50 rounded-lg p-4">
                <h4 className="font-medium mb-2">선택 블록 정보</h4>
                <div className="space-y-1 text-sm">
                  <p>블록 수: <span className="font-medium">{selectedBlockInfo.coordinates.length}개</span></p>
                  <p>총 면적: <span className="font-medium">{selectedBlockInfo.totalArea.toFixed(2)} m²</span></p>
                  {selectedBlockInfo.centroid && (
                    <p>중심: [{selectedBlockInfo.centroid[0].toFixed(6)}, {selectedBlockInfo.centroid[1].toFixed(6)}]</p>
                  )}
                  <details className="mt-2">
                    <summary className="text-xs text-blue-600 cursor-pointer hover:text-blue-800">
                      블록 좌표 보기
                    </summary>
                    <div className="mt-2 space-y-2 max-h-48 overflow-y-auto">
                      {selectedBlockInfo.coordinates.map((coords, i) => (
                        <div key={i} className="bg-white rounded p-2 text-xs text-gray-600">
                          <p className="font-medium text-gray-700 mb-1">블록 {i + 1} ({coords.length}개 꼭짓점)</p>
                          {coords.map((c, j) => (
                            <p key={j}>[{c[0].toFixed(6)}, {c[1].toFixed(6)}]</p>
                          ))}
                        </div>
                      ))}
                    </div>
                  </details>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 매스 설정 탭 */}
        {activeTab === 'mass' && (
          <div className="space-y-4">
            <h3 className="font-semibold text-lg">건물 매스 설정</h3>

            {/* 업로드된 DXF 파일 목록 (DB 기반) */}
            {projectId && (
              <div className="border-b pb-4">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-medium">업로드된 도면</h4>
                  <button
                    onClick={refreshDxfList}
                    className="text-xs text-gray-500 hover:text-gray-700"
                    title="새로고침"
                  >
                    {dxfListLoading ? '⟳' : '↻'}
                  </button>
                </div>
                {dxfList.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-3">
                    {dxfListLoading ? '불러오는 중…' : '업로드된 도면이 없습니다'}
                  </p>
                ) : (
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {dxfList.map((dxf) => (
                      <div
                        key={dxf.id}
                        className="flex items-center gap-2 rounded border border-gray-200 bg-white p-2"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-gray-800 truncate">
                            {dxf.original_filename}
                          </p>
                          <div className="flex items-center gap-1.5 text-[10px] text-gray-500 mt-0.5">
                            <span>{(dxf.total_entities ?? 0).toLocaleString()}개 엔티티</span>
                            <span>·</span>
                            <span>{dxf.available_layers.length}개 레이어</span>
                            {dxf.is_classified && (
                              <span className="px-1 rounded bg-green-100 text-green-700">
                                분류됨
                              </span>
                            )}
                            {dxf.generated_model_count > 0 && (
                              <span className="px-1 rounded bg-blue-100 text-blue-700">
                                3D {dxf.generated_model_count}
                              </span>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => handleDeleteDxf(dxf)}
                          className="px-1.5 py-1 text-red-500 hover:bg-red-50 rounded shrink-0"
                          title="삭제"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 생성된 매스 모델 목록 */}
            {generatedMasses.length > 0 && (
              <div className="border-b pb-4">
                <h4 className="font-medium mb-2">생성된 매스 모델</h4>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {generatedMasses.map((mass) => (
                    <div
                      key={mass.id}
                      className="rounded-lg border border-gray-200 p-3 bg-white"
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <p className="font-medium text-sm text-gray-800 truncate flex-1">
                          {mass.label}
                        </p>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 ml-2 shrink-0">
                          {mass.classification.total_entities}개 엔티티
                        </span>
                      </div>
                      <div className="text-xs text-gray-500 space-y-0.5 mb-2">
                        <p>면적: {mass.area.toFixed(1)} m² · {mass.floors}층 · {mass.height}m</p>
                        <p>신뢰도: {(mass.classification.average_confidence * 100).toFixed(0)}%</p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handlePlaceMass(mass)}
                          disabled={selectedBlockCount === 0 || isLoadingModel}
                          className={`flex-1 text-sm py-1.5 rounded-lg font-medium transition-colors ${
                            selectedBlockCount === 0
                              ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                              : isLoadingModel
                                ? 'bg-gray-100 text-gray-400 cursor-wait'
                                : 'bg-blue-600 text-white hover:bg-blue-700'
                          }`}
                        >
                          영역에 배치
                        </button>
                        <button
                          onClick={() => useProjectStore.getState().removeGeneratedMass(mass.id)}
                          className="px-2 py-1.5 text-sm text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
                          title="삭제"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 3D 샘플 모델 로드 */}
            <div className="border-b pb-4">
              <h4 className="font-medium mb-2">3D 샘플 모델</h4>
              {selectedBlockCount > 0 ? (
                <div className="bg-green-50 rounded-lg p-2 mb-3">
                  <p className="text-xs text-green-700">
                    <span className="font-medium">선택된 블록:</span> {selectedBlockCount}개
                  </p>
                </div>
              ) : (
                <p className="text-sm text-gray-500 mb-3">
                  먼저 지도에서 <span className="font-medium">'지역 선택'</span> 후 <span className="font-medium">'영역 선택'</span>으로 블록을 지정하세요.
                </p>
              )}
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {availableModels.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-4">모델을 불러오는 중...</p>
                ) : (
                  availableModels.map((model) => (
                    <button
                      key={model.filename}
                      onClick={() => handleLoadSampleModel(model.filename)}
                      disabled={selectedBlockCount === 0 || isLoadingModel}
                      className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                        selectedBlockCount === 0
                          ? 'border-gray-200 bg-gray-100 opacity-50 cursor-not-allowed'
                          : isLoadingModel
                            ? 'border-gray-200 bg-gray-100 cursor-wait'
                            : 'border-gray-200 hover:border-purple-400 hover:bg-purple-50'
                      }`}
                    >
                      <div className="w-10 h-10 bg-purple-100 rounded flex items-center justify-center">
                        <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                        </svg>
                      </div>
                      <div className="flex-1 text-left">
                        <p className="font-medium text-sm">{model.displayName}</p>
                        <p className="text-xs text-gray-500">{model.sizeFormatted}</p>
                      </div>
                    </button>
                  ))
                )}
              </div>
              {loadedModelEntity && (
                <div className="mt-3 space-y-3">
                  {/* 로딩 상태 표시 */}
                  {isLoadingModel && (
                    <div className="bg-yellow-50 rounded-lg p-3 text-xs text-yellow-700 text-center">
                      모델 로딩 중...
                    </div>
                  )}

                  {/* 조작 방법 안내 */}
                  <div className="bg-blue-50 rounded-lg p-3 text-xs text-blue-700">
                    <p className="font-medium mb-1">모델 조작</p>
                    <p>- 좌클릭 드래그: 이동</p>
                    <p>- 휠클릭 드래그: 회전 (마우스 방향)</p>
                  </div>

                  {/* 높이 조절 슬라이더 + 입력 */}
                  <div className="bg-gray-50 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm font-medium text-gray-700">높이</label>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min={-10}
                          max={30}
                          step={0.5}
                          value={modelTransform.height}
                          onChange={(e) => handleModelHeightChange(Number(e.target.value))}
                          className="w-16 px-2 py-1 text-sm border rounded text-right"
                        />
                        <span className="text-sm text-gray-500">m</span>
                      </div>
                    </div>
                    <input
                      type="range"
                      min={-10}
                      max={30}
                      step={0.5}
                      value={modelTransform.height}
                      onChange={(e) => handleModelHeightChange(Number(e.target.value))}
                      className="w-full"
                    />
                    <div className="flex justify-between text-xs text-gray-500 mt-1">
                      <span>-10m</span>
                      <span>0m</span>
                      <span>+30m</span>
                    </div>
                  </div>

                  {/* 회전 조절 슬라이더 + 입력 */}
                  <div className="bg-gray-50 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm font-medium text-gray-700">회전</label>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min={0}
                          max={360}
                          step={1}
                          value={Math.round(modelTransform.rotation)}
                          onChange={(e) => handleModelRotationChange(Number(e.target.value) % 360)}
                          className="w-16 px-2 py-1 text-sm border rounded text-right"
                        />
                        <span className="text-sm text-gray-500">°</span>
                      </div>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={360}
                      step={1}
                      value={modelTransform.rotation}
                      onChange={(e) => handleModelRotationChange(Number(e.target.value))}
                      className="w-full"
                    />
                    <div className="flex justify-between text-xs text-gray-500 mt-1">
                      <span>0°</span>
                      <span>180°</span>
                      <span>360°</span>
                    </div>
                  </div>

                  {/* 스케일 조절 슬라이더 + 입력 */}
                  <div className="bg-gray-50 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm font-medium text-gray-700">스케일</label>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min={1}
                          max={50}
                          step={1}
                          value={modelTransform.scale}
                          onChange={(e) => handleModelScaleChange(Number(e.target.value))}
                          className="w-16 px-2 py-1 text-sm border rounded text-right"
                        />
                        <span className="text-sm text-gray-500">x</span>
                      </div>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={50}
                      step={1}
                      value={modelTransform.scale}
                      onChange={(e) => handleModelScaleChange(Number(e.target.value))}
                      className="w-full"
                    />
                    <div className="flex justify-between text-xs text-gray-500 mt-1">
                      <span>1x</span>
                      <span>25x</span>
                      <span>50x</span>
                    </div>
                  </div>

                  {/* 위치 정보 표시 */}
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs text-gray-600">
                      위치: [{modelTransform.longitude.toFixed(6)}, {modelTransform.latitude.toFixed(6)}]
                    </p>
                  </div>

                  {/* 휴먼 스케일 비교 모델 */}
                  <div className="border-t pt-3">
                    <p className="text-xs text-gray-500 mb-2">휴먼 스케일 비교 (180cm)</p>
                    <button
                      onClick={() => setHumanScaleModelLoaded(!humanScaleModelLoaded)}
                      className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                        humanScaleModelLoaded
                          ? 'bg-orange-100 text-orange-700 hover:bg-orange-200'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                      {humanScaleModelLoaded ? '사람 모델 제거' : '사람 모델 추가'}
                    </button>
                  </div>

                  <button
                    onClick={handleRemoveModel}
                    className="w-full text-red-600 text-sm hover:text-red-700"
                  >
                    모델 제거
                  </button>
                </div>
              )}
            </div>

          </div>
        )}

        {/* 검토 탭 */}
        {activeTab === 'validate' && (
          <div className="space-y-4">
            <h3 className="font-semibold text-lg">건축 규정 검토</h3>

            <button
              onClick={() => runReviewCheckFn?.()}
              disabled={!loadedModelEntity || selectedBlockCount === 0}
              className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
            >
              배치 검토 실행
            </button>

            {/* 건폐율 */}
            {reviewData.buildingCoverage && (
              <div className={`rounded-lg p-3 ${reviewData.buildingCoverage.status === 'OK' ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm font-medium">건폐율</span>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded ${reviewData.buildingCoverage.status === 'OK' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {reviewData.buildingCoverage.status === 'OK' ? '적합' : '초과'}
                  </span>
                </div>
                <div className="text-2xl font-bold text-gray-800 mb-1">
                  {reviewData.buildingCoverage.ratio}%
                  <span className="text-sm font-normal text-gray-500 ml-1">/ {reviewData.buildingCoverage.limit}%</span>
                </div>
                <div className="text-xs text-gray-500 space-y-0.5">
                  <p>건축면적: {reviewData.buildingCoverage.buildingArea.toFixed(1)} m²</p>
                  <p>대지면적: {reviewData.buildingCoverage.siteArea.toFixed(1)} m²</p>
                </div>
                {/* 프로그레스 바 */}
                <div className="mt-2 w-full bg-gray-200 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all ${reviewData.buildingCoverage.status === 'OK' ? 'bg-green-500' : 'bg-red-500'}`}
                    style={{ width: `${Math.min(reviewData.buildingCoverage.ratio / reviewData.buildingCoverage.limit * 100, 100)}%` }}
                  />
                </div>
              </div>
            )}

            {/* 이격거리 */}
            {reviewData.setback && (
              <div className={`rounded-lg p-3 ${reviewData.setback.status === 'OK' ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm font-medium">이격거리</span>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded ${reviewData.setback.status === 'OK' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {reviewData.setback.status === 'OK' ? '적합' : '위반'}
                  </span>
                </div>
                <div className="text-2xl font-bold text-gray-800 mb-1">
                  {reviewData.setback.minDistance}m
                  <span className="text-sm font-normal text-gray-500 ml-1">/ 최소 {reviewData.setback.required}m</span>
                </div>
                {reviewData.setback.details.map((d, i) => (
                  <div key={i} className="flex justify-between text-xs text-gray-600 mt-1">
                    <span>{d.type}</span>
                    <span className={d.status === 'OK' ? 'text-green-600' : 'text-red-600'}>{d.distance}m / {d.required}m</span>
                  </div>
                ))}
              </div>
            )}

            {/* 영역 내 배치 */}
            {reviewData.buildingCoverage && (
              <div className={`rounded-lg p-3 ${reviewData.isModelInBounds ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium">영역 내 배치</span>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded ${reviewData.isModelInBounds ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {reviewData.isModelInBounds ? '적합' : '영역 초과'}
                  </span>
                </div>
              </div>
            )}

            {/* 전체 판정 */}
            {reviewData.buildingCoverage && (
              <div className={`p-4 rounded-lg text-center ${
                reviewData.buildingCoverage.status === 'OK' && (!reviewData.setback || reviewData.setback.status === 'OK') && reviewData.isModelInBounds
                  ? 'bg-green-100 border-2 border-green-300'
                  : 'bg-red-100 border-2 border-red-300'
              }`}>
                <p className={`text-lg font-bold ${
                  reviewData.buildingCoverage.status === 'OK' && (!reviewData.setback || reviewData.setback.status === 'OK') && reviewData.isModelInBounds
                    ? 'text-green-700' : 'text-red-700'
                }`}>
                  {reviewData.buildingCoverage.status === 'OK' && (!reviewData.setback || reviewData.setback.status === 'OK') && reviewData.isModelInBounds
                    ? '종합: 적합' : '종합: 부적합'}
                </p>
              </div>
            )}

            {/* 일조 분석 */}
            <div className="border-t pt-4">
              <h3 className="font-semibold text-base mb-3">일조 분석</h3>

              <div className="space-y-2 mb-3">
                <div>
                  <label className="text-xs text-gray-600">날짜</label>
                  <input
                    type="date"
                    value={sunlightDate.toISOString().split('T')[0]}
                    onChange={(e) => {
                      const d = new Date(e.target.value)
                      d.setHours(sunlightDate.getHours())
                      setSunlightDate(d)
                    }}
                    className="input-field text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-600">시간: {sunlightDate.getHours()}시</label>
                  <input
                    type="range"
                    min="0"
                    max="23"
                    value={sunlightDate.getHours()}
                    onChange={(e) => {
                      const d = new Date(sunlightDate)
                      d.setHours(parseInt(e.target.value))
                      setSunlightDate(d)
                    }}
                    className="w-full"
                  />
                </div>
              </div>

              <button
                onClick={() => startSunlightFn?.(sunlightDate, 2)}
                disabled={sunlightAnalysisState.isAnalyzing || !startSunlightFn}
                className={`w-full py-2 px-3 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
                  sunlightAnalysisState.isAnalyzing
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    : 'bg-blue-500 hover:bg-blue-600 text-white'
                }`}
              >
                {sunlightAnalysisState.isAnalyzing ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
                    분석 중...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
                    일조 분석 시작
                  </>
                )}
              </button>

              {/* 진행률 */}
              {sunlightAnalysisState.isAnalyzing && sunlightAnalysisState.progress && (
                <div className="mt-2">
                  <div className="flex justify-between text-xs text-gray-600 mb-1">
                    <span>{sunlightAnalysisState.progress.currentHour}시 분석 중</span>
                    <span>{sunlightAnalysisState.progress.percentComplete}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div className="bg-blue-500 h-2 rounded-full transition-all" style={{ width: `${sunlightAnalysisState.progress.percentComplete}%` }} />
                  </div>
                </div>
              )}

              {/* 분석 결과 */}
              {sunlightAnalysisState.result && !sunlightAnalysisState.isAnalyzing && (
                <div className="mt-3 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-medium text-gray-700">분석 결과</span>
                    <div className="flex gap-1">
                      <button onClick={() => toggleSunlightHeatmapFn?.()} className={`px-2 py-1 text-xs rounded ${sunlightAnalysisState.showHeatmap ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                        {sunlightAnalysisState.showHeatmap ? '히트맵 숨김' : '히트맵 표시'}
                      </button>
                      <button onClick={() => clearSunlightFn?.()} className="px-2 py-1 text-xs bg-red-100 text-red-600 rounded hover:bg-red-200">초기화</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="bg-blue-50 rounded p-2 text-center">
                      <div className="text-blue-600 font-medium">평균</div>
                      <div className="text-gray-800 font-bold">{sunlightAnalysisState.result.averageSunlightHours.toFixed(1)}h</div>
                    </div>
                    <div className="bg-red-50 rounded p-2 text-center">
                      <div className="text-red-600 font-medium">최소</div>
                      <div className="text-gray-800 font-bold">{sunlightAnalysisState.result.minSunlightHours}h</div>
                    </div>
                    <div className="bg-green-50 rounded p-2 text-center">
                      <div className="text-green-600 font-medium">최대</div>
                      <div className="text-gray-800 font-bold">{sunlightAnalysisState.result.maxSunlightHours}h</div>
                    </div>
                  </div>
                  <div className="text-xs text-gray-500">{sunlightAnalysisState.result.totalPoints}개 포인트 | {sunlightAnalysisState.result.analysisDate}</div>
                  {/* 히트맵 범례 */}
                  <div className="pt-2 border-t border-gray-100">
                    <div className="text-xs text-gray-600 mb-1">범례 (일조시간)</div>
                    <div className="flex h-3 rounded overflow-hidden">
                      <div className="flex-1 bg-red-500" />
                      <div className="flex-1 bg-orange-500" />
                      <div className="flex-1 bg-yellow-500" />
                      <div className="flex-1 bg-lime-500" />
                      <div className="flex-1 bg-green-500" />
                    </div>
                    <div className="flex justify-between text-xs text-gray-400 mt-0.5">
                      <span>0h</span><span>13h</span>
                    </div>
                  </div>
                  {/* 히트맵 모드 */}
                  <div className="flex gap-2">
                    <button onClick={() => setSunlightHeatmapModeFn?.('point')} className={`flex-1 py-1 text-xs rounded ${sunlightAnalysisState.heatmapMode === 'point' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-600'}`}>포인트</button>
                    <button onClick={() => setSunlightHeatmapModeFn?.('cell')} className={`flex-1 py-1 text-xs rounded ${sunlightAnalysisState.heatmapMode === 'cell' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-600'}`}>셀</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 주차구역 탭 */}
        {activeTab === 'parking' && (
          <ParkingZonePanel />
        )}
      </div>

      {/* Analysis Modal */}
      <AnalysisModal
        isOpen={showAnalysisModal}
        onClose={() => {
          setShowAnalysisModal(false)
          setAnalysisFile(null)
        }}
        onComplete={handleAnalysisComplete}
        file={analysisFile}
        anchorLonLat={
          selectedBlockInfo?.centroid
            ? selectedBlockInfo.centroid
            : workArea
              ? [workArea.longitude, workArea.latitude]
              : undefined
        }
      />
    </div>
  )
}
