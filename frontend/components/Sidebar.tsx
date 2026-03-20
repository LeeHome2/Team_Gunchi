'use client'

import { useState } from 'react'
import { useProjectStore } from '@/store/projectStore'
import { uploadDxf, generateMass, validatePlacement } from '@/lib/api'

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
    isLoadingModel,
    humanScaleModelLoaded,
    setSite,
    setBuilding,
    setModelUrl,
    setValidation,
    setLoading,
    setError,
    setSelectedModel,
    setLoadedModelEntity,
    setModelTransform,
    setModelToLoad,
    setHumanScaleModelLoaded,
  } = useProjectStore()

  const [height, setHeight] = useState(30)
  const [floors, setFloors] = useState(10)
  const [activeTab, setActiveTab] = useState<'upload' | 'mass' | 'validate'>('upload')

  // 매스 이동/회전
  const [offsetX, setOffsetX] = useState(0) // 미터 단위
  const [offsetY, setOffsetY] = useState(0) // 미터 단위
  const [rotation, setRotation] = useState(0) // 도 단위

  // 샘플 데이터 로드 (테스트용)
  const handleLoadSample = () => {
    // 성남시 좌표 기준 샘플 대지 (약 300m² 사각형)
    const sampleSite = {
      fileId: 'sample',
      footprint: [
        [127.1385, 37.4447],
        [127.1390, 37.4447],
        [127.1390, 37.4451],
        [127.1385, 37.4451],
      ],
      area: 300,
      centroid: [127.13875, 37.4449],
    }
    setSite(sampleSite)
    setActiveTab('mass')
    setError(null) // 이전 에러 클리어
    console.log('샘플 대지 데이터가 로드되었습니다.')
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
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setLoading(true)
    try {
      const result = await uploadDxf(file)
      if (result.success) {
        setSite({
          fileId: result.file_id,
          footprint: result.site.footprint,
          area: result.site.area_sqm,
          centroid: result.site.centroid,
          bounds: result.site.bounds,
        })
        setActiveTab('mass')
      }
    } catch (error) {
      console.error('업로드 실패:', error)
      setError('파일 업로드에 실패했습니다.')
    } finally {
      setLoading(false)
    }
  }

  // 매스 생성
  const handleGenerateMass = async () => {
    if (!site?.footprint) {
      setError('먼저 DXF 파일을 업로드하세요.')
      return
    }

    setLoading(true)
    try {
      const result = await generateMass({
        footprint: site.footprint,
        height,
        floors,
        position: site.centroid,
      })

      if (result.success) {
        setBuilding({
          height,
          floors,
          footprint: site.footprint,
          position: site.centroid,
        })
        setModelUrl(result.model_url)
        setActiveTab('validate')
      }
    } catch (error) {
      console.error('매스 생성 실패:', error)
      setError('매스 생성에 실패했습니다.')
    } finally {
      setLoading(false)
    }
  }

  // 배치 검토
  const handleValidate = async () => {
    if (!site?.footprint || !building?.footprint) {
      setError('대지와 건물 정보가 필요합니다.')
      return
    }

    setLoading(true)
    try {
      const result = await validatePlacement({
        site_footprint: site.footprint,
        building_footprint: building.footprint,
        building_height: building.height,
      })

      setValidation(result)
    } catch (error) {
      console.error('검토 실패:', error)
      setError('배치 검토에 실패했습니다.')
    } finally {
      setLoading(false)
    }
  }

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
          onClick={() => setActiveTab('validate')}
          className={`flex-1 py-3 text-sm font-medium ${
            activeTab === 'validate'
              ? 'text-primary-600 border-b-2 border-primary-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          3. 검토
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

            {/* 샘플 데이터 로드 버튼 */}
            <div className="border-t pt-4">
              <p className="text-sm text-gray-500 mb-2">DXF 파일이 없으신가요?</p>
              <button
                onClick={handleLoadSample}
                className="btn-secondary w-full"
              >
                샘플 데이터로 테스트
              </button>
            </div>

            {/* 3D 샘플 모델 로드 */}
            <div className="border-t pt-4">
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
          </div>
        )}

        {/* 매스 설정 탭 */}
        {activeTab === 'mass' && (
          <div className="space-y-4">
            <h3 className="font-semibold text-lg">건물 매스 설정</h3>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                건물 높이 (m)
              </label>
              <input
                type="number"
                value={height}
                onChange={(e) => setHeight(Number(e.target.value))}
                min={1}
                max={100}
                className="input-field"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                층수
              </label>
              <input
                type="number"
                value={floors}
                onChange={(e) => setFloors(Number(e.target.value))}
                min={1}
                max={30}
                className="input-field"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                층고 (m)
              </label>
              <p className="text-sm text-gray-600">{(height / floors).toFixed(2)}</p>
            </div>

            <button
              onClick={handleGenerateMass}
              disabled={!site}
              className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
            >
              3D 매스 생성
            </button>

            {/* 카메라 이동 버튼 */}
            {site?.centroid && (
              <button
                onClick={() => {
                  const state = useProjectStore.getState()
                  const viewer = state.viewer
                  const Cesium = (window as any).Cesium

                  if (!viewer || !Cesium) {
                    setError('Viewer가 로드되지 않았습니다.')
                    return
                  }

                  viewer.camera.flyTo({
                    destination: Cesium.Cartesian3.fromDegrees(
                      site.centroid![0],
                      site.centroid![1],
                      200
                    ),
                    orientation: {
                      heading: 0,
                      pitch: Cesium.Math.toRadians(-45),
                      roll: 0,
                    },
                    duration: 1.5,
                  })
                }}
                className="btn-secondary w-full"
              >
                건물 위치로 이동
              </button>
            )}

            {/* 매스 이동/회전 컨트롤 */}
            {building && (
              <div className="border-t pt-4 mt-4 space-y-3">
                <h4 className="font-medium text-sm">매스 이동/회전</h4>

                <div>
                  <label className="block text-xs text-gray-600 mb-1">
                    X 이동: {offsetX}m
                  </label>
                  <input
                    type="range"
                    min={-50}
                    max={50}
                    value={offsetX}
                    onChange={(e) => setOffsetX(Number(e.target.value))}
                    className="w-full"
                  />
                </div>

                <div>
                  <label className="block text-xs text-gray-600 mb-1">
                    Y 이동: {offsetY}m
                  </label>
                  <input
                    type="range"
                    min={-50}
                    max={50}
                    value={offsetY}
                    onChange={(e) => setOffsetY(Number(e.target.value))}
                    className="w-full"
                  />
                </div>

                <div>
                  <label className="block text-xs text-gray-600 mb-1">
                    회전: {rotation}°
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={360}
                    value={rotation}
                    onChange={(e) => setRotation(Number(e.target.value))}
                    className="w-full"
                  />
                </div>

                <button
                  onClick={() => {
                    // 변환 적용
                    const viewer = useProjectStore.getState().viewer
                    const Cesium = (window as any).Cesium
                    if (!viewer || !Cesium || !site?.footprint) return

                    // 기존 건물 제거
                    const existing = viewer.entities.getById('building-mass')
                    if (existing) viewer.entities.remove(existing)

                    // 중심점 기준 이동/회전 계산
                    const centroid = site.centroid || [127.1388, 37.4449]
                    const latRad = centroid[1] * Math.PI / 180
                    const metersPerDegLon = 111320 * Math.cos(latRad)
                    const metersPerDegLat = 111320

                    // 회전 변환 함수
                    const rotatePoint = (x: number, y: number, angle: number, cx: number, cy: number) => {
                      const rad = angle * Math.PI / 180
                      const cos = Math.cos(rad)
                      const sin = Math.sin(rad)
                      const nx = cos * (x - cx) - sin * (y - cy) + cx
                      const ny = sin * (x - cx) + cos * (y - cy) + cy
                      return [nx, ny]
                    }

                    // footprint 변환 (이동 + 회전)
                    const transformedFootprint = site.footprint.map((coord: number[]) => {
                      // 1. 미터 단위로 이동
                      const movedLon = coord[0] + (offsetX / metersPerDegLon)
                      const movedLat = coord[1] + (offsetY / metersPerDegLat)

                      // 2. 중심점 기준 회전
                      const [rotLon, rotLat] = rotatePoint(
                        movedLon, movedLat, rotation,
                        centroid[0] + (offsetX / metersPerDegLon),
                        centroid[1] + (offsetY / metersPerDegLat)
                      )

                      return [rotLon, rotLat]
                    })

                    // 새 건물 추가
                    const positions = transformedFootprint.flatMap((c: number[]) => [c[0], c[1]])
                    viewer.entities.add({
                      id: 'building-mass',
                      name: '건물 매스',
                      polygon: {
                        hierarchy: Cesium.Cartesian3.fromDegreesArray(positions),
                        height: 0,
                        extrudedHeight: height,
                        material: Cesium.Color.CORNFLOWERBLUE.withAlpha(0.8),
                        outline: true,
                        outlineColor: Cesium.Color.WHITE,
                        heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
                        extrudedHeightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
                      },
                    })

                    console.log('매스 변환 적용:', { offsetX, offsetY, rotation })
                  }}
                  className="btn-primary w-full"
                >
                  변환 적용
                </button>

                <button
                  onClick={() => {
                    setOffsetX(0)
                    setOffsetY(0)
                    setRotation(0)
                  }}
                  className="btn-secondary w-full"
                >
                  초기화
                </button>
              </div>
            )}
          </div>
        )}

        {/* 검토 탭 */}
        {activeTab === 'validate' && (
          <div className="space-y-4">
            <h3 className="font-semibold text-lg">건축 규정 검토</h3>

            <button
              onClick={handleValidate}
              disabled={!building}
              className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
            >
              배치 검토 실행
            </button>

            {/* 검토 결과 */}
            {validation && (
              <div className="space-y-3">
                {/* 전체 판정 */}
                <div
                  className={`p-3 rounded-lg ${
                    validation.is_valid
                      ? 'bg-green-50 border border-green-200'
                      : 'bg-red-50 border border-red-200'
                  }`}
                >
                  <p
                    className={`font-semibold ${
                      validation.is_valid ? 'text-green-700' : 'text-red-700'
                    }`}
                  >
                    {validation.is_valid ? '적합' : '부적합'}
                  </p>
                </div>

                {/* 건폐율 */}
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-sm font-medium">건폐율</span>
                    <span
                      className={
                        validation.building_coverage.status === 'OK'
                          ? 'validation-ok'
                          : 'validation-error'
                      }
                    >
                      {validation.building_coverage.status}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600">
                    {validation.building_coverage.value}% / {validation.building_coverage.limit}%
                  </p>
                </div>

                {/* 이격거리 */}
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-sm font-medium">이격거리</span>
                    <span
                      className={
                        validation.setback.status === 'OK'
                          ? 'validation-ok'
                          : 'validation-error'
                      }
                    >
                      {validation.setback.status}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600">
                    {validation.setback.min_distance_m}m / {validation.setback.required_m}m
                  </p>
                </div>

                {/* 높이 */}
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-sm font-medium">높이 제한</span>
                    <span
                      className={
                        validation.height.status === 'OK'
                          ? 'validation-ok'
                          : 'validation-error'
                      }
                    >
                      {validation.height.status}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600">
                    {validation.height.value_m}m / {validation.height.limit_m}m
                  </p>
                </div>

                {/* 위반 사항 */}
                {validation.violations.length > 0 && (
                  <div className="bg-red-50 rounded-lg p-3">
                    <p className="text-sm font-medium text-red-700 mb-2">위반 사항</p>
                    <ul className="space-y-1">
                      {validation.violations.map((v: any, i: number) => (
                        <li key={i} className="text-sm text-red-600">
                          • {v.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
