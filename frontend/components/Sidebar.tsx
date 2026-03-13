'use client'

import { useState } from 'react'
import { useProjectStore, SAMPLE_MODELS } from '@/store/projectStore'
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
    setSite,
    setBuilding,
    setModelUrl,
    setValidation,
    setLoading,
    setSelectedModel,
    setLoadedModelEntity,
    setModelTransform,
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
    alert('샘플 대지 데이터가 로드되었습니다!')
  }

  // 3D 샘플 모델 로드
  const handleLoadSampleModel = async (modelId: string) => {
    const model = SAMPLE_MODELS.find(m => m.id === modelId)
    if (!model || !viewer) {
      alert('모델을 로드할 수 없습니다.')
      return
    }

    const Cesium = (window as any).Cesium
    if (!Cesium) return

    setLoading(true)
    try {
      // 기존 모델 제거
      if (loadedModelEntity) {
        viewer.entities.remove(loadedModelEntity)
      }

      // 좌표 설정 (우선순위: 작업 영역 > 대지 중심 > 기본값)
      const lon = workArea?.longitude || site?.centroid?.[0] || 127.1388
      const lat = workArea?.latitude || site?.centroid?.[1] || 37.4449

      // 모델 변환 정보 초기화 (회전 기본값 180도)
      const initialRotation = 180
      setModelTransform({
        longitude: lon,
        latitude: lat,
        height: 0,
        rotation: initialRotation,
      })

      // 모델 위치 (지형 기준 상대 높이)
      const position = Cesium.Cartesian3.fromDegrees(lon, lat, 0)

      // 초기 회전 적용 (180도)
      const heading = Cesium.Math.toRadians(initialRotation)
      const hpr = new Cesium.HeadingPitchRoll(heading, 0, 0)
      const orientation = Cesium.Transforms.headingPitchRollQuaternion(position, hpr)

      // GLB 모델 로드 - 지형 기준 상대 높이로 배치
      const entity = viewer.entities.add({
        id: 'loaded-3d-model',
        name: model.name,
        position: position,
        orientation: orientation,
        model: {
          uri: model.url,
          scale: 5.0,
          heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
        },
      })

      setSelectedModel(model)
      setLoadedModelEntity(entity)

      // 모델 위치로 카메라 이동 (탑뷰)
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(lon, lat, 150),
        orientation: {
          heading: Cesium.Math.toRadians(0),
          pitch: Cesium.Math.toRadians(-90), // 탑뷰 (수직 아래)
          roll: 0,
        },
        duration: 1.5,
      })

      console.log('모델 로드 완료:', { lon, lat, model: model.name })
      alert(`${model.name} 모델이 로드되었습니다!\n\n조작 방법:\n- 좌클릭 드래그: 모델 이동\n- 휠클릭 드래그: 모델 회전`)
    } catch (error) {
      console.error('모델 로드 실패:', error)
      alert('모델 로드에 실패했습니다.')
    } finally {
      setLoading(false)
    }
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
      alert('파일 업로드에 실패했습니다.')
    } finally {
      setLoading(false)
    }
  }

  // 매스 생성
  const handleGenerateMass = async () => {
    if (!site?.footprint) {
      alert('먼저 DXF 파일을 업로드하세요.')
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
      alert('매스 생성에 실패했습니다.')
    } finally {
      setLoading(false)
    }
  }

  // 배치 검토
  const handleValidate = async () => {
    if (!site?.footprint || !building?.footprint) {
      alert('대지와 건물 정보가 필요합니다.')
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
      alert('배치 검토에 실패했습니다.')
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
              {workArea ? (
                <div className="bg-blue-50 rounded-lg p-2 mb-3">
                  <p className="text-xs text-blue-700">
                    <span className="font-medium">선택된 영역:</span> {workArea.address}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-gray-500 mb-3">
                  먼저 지도에서 <span className="font-medium">'영역 선택'</span> 버튼으로 작업 영역을 지정하세요.
                </p>
              )}
              <div className="space-y-2">
                {SAMPLE_MODELS.map((model) => (
                  <button
                    key={model.id}
                    onClick={() => handleLoadSampleModel(model.id)}
                    className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                      selectedModel?.id === model.id
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <div className="w-10 h-10 bg-gray-200 rounded flex items-center justify-center">
                      <svg className="w-6 h-6 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                      </svg>
                    </div>
                    <div className="flex-1 text-left">
                      <p className="font-medium text-sm">{model.name}</p>
                      <p className="text-xs text-gray-500">GLB 모델</p>
                    </div>
                    {selectedModel?.id === model.id && (
                      <span className="text-blue-600 text-xs font-medium">로드됨</span>
                    )}
                  </button>
                ))}
              </div>
              {selectedModel && (
                <div className="mt-3 space-y-3">
                  {/* 조작 방법 안내 */}
                  <div className="bg-blue-50 rounded-lg p-3 text-xs text-blue-700">
                    <p className="font-medium mb-1">모델 조작</p>
                    <p>- 좌클릭 드래그: 이동</p>
                    <p>- 휠클릭 드래그: 회전 (마우스 방향)</p>
                  </div>

                  {/* 높이 조절 슬라이더 */}
                  <div className="bg-gray-50 rounded-lg p-3">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      높이: {modelTransform.height.toFixed(1)}m
                    </label>
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

                  {/* 회전 조절 슬라이더 */}
                  <div className="bg-gray-50 rounded-lg p-3">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      회전: {modelTransform.rotation.toFixed(0)}°
                    </label>
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

                  {/* 위치 정보 표시 */}
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs text-gray-600">
                      위치: [{modelTransform.longitude.toFixed(6)}, {modelTransform.latitude.toFixed(6)}]
                    </p>
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
                    alert('Viewer가 로드되지 않았습니다.')
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
