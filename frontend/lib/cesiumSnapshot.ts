/**
 * Cesium 뷰포트 스크린샷 유틸
 *
 * 결과 확인 페이지(`/editor/result`) 로 이동하기 직전에 현재 Cesium 뷰포트를
 * 두 장으로 캡처한다:
 *
 *   1. `topDown` — 카메라를 현재 대지 중심 위로 끌어올려 수직(-90°) 으로 내려다본
 *      "배치도" 스타일 샷. 나중에 학교 LLM 이미지 생성 기능이 붙으면 이 샷을
 *      입력으로 넘겨 배치도 렌더링을 대체한다.
 *
 *   2. (optional) `aerial` — 45° 각도의 조감도 스타일 샷. 현재 결과 페이지는
 *      플레이스홀더를 사용하므로 이 함수는 호출하지 않지만, STAGE 6 붙였을 때
 *      바로 재사용 가능하도록 인터페이스를 미리 노출한다.
 *
 * Cesium 은 WebGL 기반이라 `canvas.toDataURL()` 이 정상 동작하려면
 * `preserveDrawingBuffer: true` 로 뷰어가 초기화되어 있어야 한다. 현재
 * `useCesiumViewer` 에서 이미 그렇게 설정되어 있다.
 */

type AnyViewer = any

interface CaptureOptions {
  /** dataURL 포맷. 기본 image/png */
  mime?: string
  /** JPEG 품질 (mime 이 image/jpeg 일 때만) */
  quality?: number
  /** 렌더 완료 대기 시간 (ms). 카메라 이동 후 타일이 다시 그려질 시간이 필요함. */
  settleMs?: number
  /** AI 렌더링용 - 시각화 엔티티(대지경계선, 건축선, 주차구역 등) 숨김 */
  hideOverlays?: boolean
}

/**
 * 시각화 오버레이 엔티티 ID 패턴
 * 캡처 시 숨길 엔티티들의 ID 패턴
 */
/**
 * 캡처 시 숨길 오버레이 엔티티 ID 패턴
 * 주의: 'model-boundary'는 건축영역 바운더리로 유지해야 함
 */
const OVERLAY_ENTITY_ID_PATTERNS = [
  '_parking_',       // 주차구역 관련
  '_building_line',  // 건축선
  '_grid_',          // 그리드
  'site-boundary',   // 대지 경계선 (지적도)
  'block-',          // 블록 선택 영역
  'parking-',        // 주차 관련
  'grid-',           // 그리드 관련
  'setback-',        // 이격거리 라인
  'road-',           // 도로변
  'adjacent-',       // 인접대지변
  'opening-line-',   // 개구부 라인
  'main-entrance-',  // 메인 출입구 마커
  'human-scale-',    // 휴먼 스케일 모델
]

/**
 * 캡처 시 유지할 엔티티 ID 패턴 (화이트리스트)
 */
const KEEP_ENTITY_ID_PATTERNS = [
  'model-boundary',   // 건축영역 바운더리 - 반드시 유지
  'loaded-3d-model',  // 3D 건물 모델 - 반드시 유지
]

/**
 * 오버레이로 인식되는 색상들 (RGB 0-1 범위)
 * - CYAN: 블록 선택 영역 (0, 1, 1)
 * - BLUE: 선택 영역 (0, 0, 1)
 * - RED: 건축선 (1, 0, 0)
 * - ORANGE: 도로변 (1, 0.647, 0)
 * - YELLOW: 인접대지변 (1, 1, 0)
 * - LIME/GREEN: 건물 바운더리 (0, 1, 0) / (0.5, 1, 0)
 * - PURPLE/MAGENTA: 대지 경계선 (0.5-1, 0, 0.5-1)
 */
/**
 * 숨길 오버레이 색상들 (RGB 0-1 범위)
 * 주의: LIME/GREEN은 건축영역 바운더리에 사용되므로 제외
 */
const OVERLAY_COLORS = [
  { r: 0, g: 1, b: 1 },       // CYAN - 블록 선택
  { r: 0, g: 0, b: 1 },       // BLUE - 선택 영역
  { r: 0, g: 0.5, b: 1 },     // LIGHT BLUE
  { r: 0.2, g: 0.6, b: 1 },   // SKY BLUE
  { r: 0.23, g: 0.51, b: 0.96 }, // #3b82f6 - 주차구역 테두리
  { r: 0.12, g: 0.23, b: 0.37 }, // #1e3a5f - 주차구역 배경
  { r: 0.58, g: 0.64, b: 0.72 }, // #94a3b8 - 차로
  { r: 1, g: 0, b: 0 },       // RED - 건축선
  { r: 1, g: 0.647, b: 0 },   // ORANGE - 도로변
  { r: 1, g: 1, b: 0 },       // YELLOW - 인접대지변 (site-boundary도 YELLOW)
  // LIME/GREEN 제외 - 건축영역 바운더리(model-boundary)에 사용됨
  { r: 0.5, g: 0, b: 0.5 },   // PURPLE - 대지 경계선
  { r: 1, g: 0, b: 1 },       // MAGENTA - 대지 경계선 (지적도)
  { r: 0.8, g: 0, b: 0.8 },   // PURPLE variant
  { r: 0.6, g: 0.2, b: 0.8 }, // PURPLE variant 2
  { r: 0.5, g: 0, b: 1 },     // VIOLET
]

/**
 * 색상이 오버레이 색상과 일치하는지 확인
 */
function isOverlayColor(color: any): boolean {
  if (!color) return false

  // Cesium Color 객체에서 RGB 추출
  const r = color.red ?? color.r
  const g = color.green ?? color.g
  const b = color.blue ?? color.b

  if (r === undefined || g === undefined || b === undefined) {
    return false
  }

  // 허용 오차 (0.1)
  const tolerance = 0.15
  return OVERLAY_COLORS.some(oc =>
    Math.abs(r - oc.r) < tolerance &&
    Math.abs(g - oc.g) < tolerance &&
    Math.abs(b - oc.b) < tolerance
  )
}

/**
 * 엔티티가 오버레이인지 확인 (숨겨야 하는지)
 */
function isOverlayEntity(entity: any): boolean {
  const id = entity.id || ''

  // 디버그: model-boundary 엔티티 체크
  if (typeof id === 'string' && id.includes('model')) {
    console.log(`[Snapshot] Checking entity with 'model' in ID: "${id}"`)
  }

  // 화이트리스트 체크 - 이 엔티티들은 절대 숨기지 않음
  for (const pattern of KEEP_ENTITY_ID_PATTERNS) {
    if (typeof id === 'string' && id.includes(pattern)) {
      console.log(`[Snapshot] ✓ Entity KEPT (whitelist match "${pattern}"): ${id}`)
      return false
    }
  }

  // ID 기반 필터링 - 숨길 패턴
  if (OVERLAY_ENTITY_ID_PATTERNS.some(pattern =>
    typeof id === 'string' && id.includes(pattern)
  )) {
    console.log(`[Snapshot] Entity matched by ID pattern: ${id}`)
    return true
  }

  // 색상 기반 필터링 - polygon
  if (entity.polygon) {
    // Check material
    const material = entity.polygon.material
    if (material) {
      // Direct Cesium.Color object
      if (material.red !== undefined && material.green !== undefined && material.blue !== undefined) {
        if (isOverlayColor(material)) {
          console.log(`[Snapshot] Entity matched by polygon material color: r=${material.red}, g=${material.green}, b=${material.blue}`)
          return true
        }
      }
      // ColorMaterialProperty with color property
      if (material.color) {
        const color = material.color.getValue?.() || material.color
        if (isOverlayColor(color)) {
          console.log(`[Snapshot] Entity matched by polygon material.color`)
          return true
        }
      }
      // getValue method
      if (material.getValue) {
        const matValue = material.getValue()
        if (matValue?.color && isOverlayColor(matValue.color)) {
          console.log(`[Snapshot] Entity matched by polygon getValue().color`)
          return true
        }
        if (matValue?.red !== undefined) {
          if (isOverlayColor(matValue)) {
            console.log(`[Snapshot] Entity matched by polygon getValue() direct color`)
            return true
          }
        }
      }
    }
    // Check outlineColor
    const outlineColor = entity.polygon.outlineColor
    if (outlineColor) {
      const color = outlineColor.getValue?.() || outlineColor
      if (isOverlayColor(color)) {
        console.log(`[Snapshot] Entity matched by polygon outlineColor`)
        return true
      }
    }
  }

  // 색상 기반 필터링 - polyline
  if (entity.polyline?.material) {
    const material = entity.polyline.material

    // LIME 색상 (model-boundary용) 명시적 확인
    if (material.red !== undefined && material.green !== undefined && material.blue !== undefined) {
      const isLimeColor = material.red < 0.2 && material.green > 0.8 && material.blue < 0.2
      if (isLimeColor) {
        console.log(`[Snapshot] ★ LIME/GREEN color detected, likely model-boundary - KEEPING: ${id}`)
        return false
      }
    }

    // Direct Cesium.Color object (e.g., Cesium.Color.MAGENTA)
    if (material.red !== undefined && material.green !== undefined && material.blue !== undefined) {
      if (isOverlayColor(material)) {
        console.log(`[Snapshot] Entity matched by polyline material color: r=${material.red}, g=${material.green}, b=${material.blue}`)
        return true
      }
    }
    // Color material
    if (material.color) {
      const color = material.color.getValue?.() || material.color
      if (isOverlayColor(color)) {
        console.log(`[Snapshot] Entity matched by polyline material.color`)
        return true
      }
    }
    // ColorMaterialProperty
    if (material._color) {
      const color = material._color.getValue?.() || material._color
      if (isOverlayColor(color)) {
        console.log(`[Snapshot] Entity matched by polyline material._color`)
        return true
      }
    }
    // Direct value
    if (material.getValue) {
      const matValue = material.getValue()
      if (matValue?.color && isOverlayColor(matValue.color)) {
        console.log(`[Snapshot] Entity matched by polyline getValue().color`)
        return true
      }
      // matValue itself might be a Color
      if (matValue?.red !== undefined) {
        if (isOverlayColor(matValue)) {
          console.log(`[Snapshot] Entity matched by polyline getValue() direct color`)
          return true
        }
      }
    }
  }

  return false
}

/**
 * 시각화 오버레이 엔티티들의 표시 상태를 변경
 *
 * 건축선, 도로변, 인접대지변, 주차구역 등 분석용 시각화 엔티티들을
 * 캡처 전에 숨기고 캡처 후 복원하는 데 사용
 */
function setOverlayEntitiesVisibility(viewer: AnyViewer, visible: boolean): Map<any, boolean> {
  const previousStates = new Map<any, boolean>()

  console.log(`[Snapshot] ========== setOverlayEntitiesVisibility called, visible=${visible} ==========`)

  if (!viewer || !viewer.entities || !viewer.entities.values) {
    console.log('[Snapshot] No viewer or entities')
    return previousStates
  }

  const entities = viewer.entities.values
  console.log(`[Snapshot] Total entities in viewer: ${entities.length}`)

  // 모든 엔티티 ID 출력
  const allIds = entities.map((e: any) => e.id || '(no-id)').join(', ')
  console.log(`[Snapshot] All entity IDs: ${allIds}`)

  // model-boundary 엔티티가 있는지 명시적 확인
  const modelBoundaryEntity = entities.find((e: any) => e.id === 'model-boundary')
  if (modelBoundaryEntity) {
    console.log(`[Snapshot] ★ model-boundary entity FOUND, current show=${modelBoundaryEntity.show}`)
  } else {
    console.log(`[Snapshot] ✗ model-boundary entity NOT FOUND in entities list`)
  }

  let hiddenCount = 0
  let skippedEntities: string[] = []
  for (const entity of entities) {
    if (isOverlayEntity(entity)) {
      previousStates.set(entity, entity.show)
      entity.show = visible
      hiddenCount++
      console.log(`[Snapshot] ${visible ? 'Showing' : 'Hiding'} entity:`, entity.id || '(no id)',
        entity.polygon ? 'polygon' : entity.polyline ? 'polyline' : 'other')
    } else {
      // Log skipped entities for debugging
      const type = entity.polygon ? 'polygon' : entity.polyline ? 'polyline' : entity.model ? 'model' : 'other'
      skippedEntities.push(`${entity.id || '(no id)'} [${type}]`)
    }
  }

  console.log(`[Snapshot] Total ${hiddenCount} overlay entities ${visible ? 'shown' : 'hidden'}`)
  if (skippedEntities.length > 0 && !visible) {
    console.log(`[Snapshot] Skipped entities (not matched):`, skippedEntities.join(', '))
  }

  return previousStates
}

/**
 * 이전 표시 상태로 복원
 */
function restoreEntityVisibility(previousStates: Map<any, boolean>) {
  previousStates.forEach((wasVisible, entity) => {
    entity.show = wasVisible
  })
}

const DEFAULTS: Required<CaptureOptions> = {
  mime: 'image/png',
  quality: 0.92,
  settleMs: 650,
  hideOverlays: false,
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

const getCesium = (): any | null =>
  typeof window !== 'undefined' ? (window as any).Cesium ?? null : null

/**
 * 현재 카메라 상태를 저장한 뒤, 주어진 destination 으로 이동해서 캡처.
 * 캡처 후 원래 카메라 상태로 복원한다.
 */
async function captureAt(
  viewer: AnyViewer,
  destination: any,
  orientation: any,
  options: Required<CaptureOptions> & { hideOverlays?: boolean },
): Promise<string> {
  console.log('[Snapshot] ===== captureAt (배치도) 시작 =====')
  console.log('[Snapshot] hideOverlays:', options.hideOverlays)

  const Cesium = getCesium()
  if (!Cesium) throw new Error('Cesium 이 로드되지 않았습니다.')
  if (!viewer || !viewer.scene || !viewer.scene.canvas) {
    throw new Error('Cesium viewer 가 준비되지 않았습니다.')
  }

  // ========== 1단계: 그림자 설정 백업 ==========
  const shadowsEnabled = viewer.shadows
  const shadowMapEnabled = viewer.shadowMap?.enabled
  const globeLighting = viewer.scene?.globe?.enableLighting
  console.log('[Snapshot] 배치도 그림자 설정 백업: viewer.shadows=', shadowsEnabled,
    ', shadowMap.enabled=', shadowMapEnabled,
    ', globe.enableLighting=', globeLighting)

  // ========== 2단계: 그림자 설정 강제 활성화 (항상) ==========
  console.log('[Snapshot] 배치도 ★★★ 그림자 설정 강제 활성화 ★★★')
  viewer.shadows = true
  if (viewer.shadowMap) {
    viewer.shadowMap.enabled = true
    if (viewer.shadowMap.maximumDistance < 500) {
      viewer.shadowMap.maximumDistance = 1000
    }
    viewer.shadowMap.softShadows = true

    // ★ 중요: shadowMap을 dirty 상태로 강제 설정
    if ((viewer.shadowMap as any)._dirty !== undefined) {
      ;(viewer.shadowMap as any)._dirty = true
      console.log('[Snapshot] 배치도 shadowMap._dirty = true 강제 설정')
    }
    if ((viewer.shadowMap as any)._outOfView !== undefined) {
      ;(viewer.shadowMap as any)._outOfView = false
    }
  }
  if (viewer.scene?.globe) {
    viewer.scene.globe.enableLighting = true
  }

  // 모든 모델 엔티티에 그림자 모드 강제 설정
  if (viewer.entities?.values) {
    for (const entity of viewer.entities.values) {
      if (entity.model) {
        const model = entity.model
        if (model.shadows !== undefined) {
          model.shadows = Cesium.ShadowMode?.ENABLED ?? 3
        }
      }
    }
  }

  // 3D 타일셋 (OSM 건물 등)에도 그림자 모드 강제 설정
  if (viewer.scene?.primitives) {
    const primitives = viewer.scene.primitives
    for (let i = 0; i < primitives.length; i++) {
      const prim = primitives.get(i)
      if (prim && prim.shadows !== undefined) {
        prim.shadows = Cesium.ShadowMode?.ENABLED ?? 3
      }
    }
  }

  // ========== 3단계: 시각화 오버레이 숨기기 ==========
  let previousOverlayStates: Map<any, boolean> | null = null
  if (options.hideOverlays) {
    console.log('[Snapshot] 배치도 ★★★ 오버레이 숨김 시작 ★★★')
    previousOverlayStates = setOverlayEntitiesVisibility(viewer, false)
    console.log('[Snapshot] 배치도 숨긴 엔티티 수:', previousOverlayStates?.size || 0)
  }

  // ========== 4단계: 카메라 이동 ==========
  // 현재 카메라 상태 백업
  const prev = {
    position: viewer.camera.position.clone(),
    direction: viewer.camera.direction.clone(),
    up: viewer.camera.up.clone(),
    right: viewer.camera.right.clone(),
  }

  // 카메라 이동 (즉시 이동 — 스크린샷이 목적이라 애니메이션 불필요)
  viewer.camera.setView({ destination, orientation })

  // ========== 5단계: requestRenderMode 일시 비활성화 ==========
  const wasRequestRenderMode = viewer.scene.requestRenderMode
  console.log('[Snapshot] 배치도 requestRenderMode 원래 상태:', wasRequestRenderMode)
  viewer.scene.requestRenderMode = false

  // requestAnimationFrame을 사용하여 실제 브라우저 렌더 프레임 대기
  const waitForFrame = () => new Promise<void>(resolve => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resolve()
      })
    })
  })

  // ========== 6단계: 렌더링 대기 ==========
  // 여러 프레임 렌더링하여 그림자 맵 계산 보장
  for (let i = 0; i < 5; i++) {
    viewer.scene.requestRender()
    await waitForFrame()
    await wait(50)
  }

  // 타일 로딩 + 그림자 계산 대기
  await wait(options.settleMs)

  // 최종 프레임 대기
  await waitForFrame()
  await wait(100)

  // 그림자 상태 확인
  console.log('[Snapshot] 배치도 캡처 직전 그림자 상태: viewer.shadows=', viewer.shadows,
    ', shadowMap.enabled=', viewer.shadowMap?.enabled)

  // ========== 7단계: 캡처 ==========
  const canvas: HTMLCanvasElement = viewer.scene.canvas

  // 마지막 렌더 요청 후 한 프레임 더 대기
  viewer.scene.requestRender()
  await waitForFrame()

  console.log('[Snapshot] 배치도 캡처 실행')
  const dataUrl = options.mime === 'image/jpeg'
    ? canvas.toDataURL('image/jpeg', options.quality)
    : canvas.toDataURL(options.mime)

  // ========== 8단계: 복원 ==========
  console.log('[Snapshot] 배치도 캡처 완료, 복원 시작')
  // 원래 카메라 복원
  viewer.camera.setView({
    destination: prev.position,
    orientation: {
      direction: prev.direction,
      up: prev.up,
    },
  })

  // 시각화 오버레이 복원
  if (previousOverlayStates) {
    restoreEntityVisibility(previousOverlayStates)
    console.log('[Snapshot] 배치도 오버레이 복원 완료')
  }

  // 그림자 설정 복원 (원래 상태로)
  console.log('[Snapshot] 배치도 그림자 설정 복원: shadows->', shadowsEnabled, ', shadowMap->', shadowMapEnabled)
  viewer.shadows = shadowsEnabled
  if (viewer.shadowMap) {
    viewer.shadowMap.enabled = shadowMapEnabled ?? true
  }
  if (viewer.scene?.globe) {
    viewer.scene.globe.enableLighting = globeLighting ?? true
  }

  // requestRenderMode 복원
  viewer.scene.requestRenderMode = wasRequestRenderMode
  console.log('[Snapshot] 배치도 requestRenderMode 복원:', wasRequestRenderMode)

  try {
    viewer.scene.requestRender()
  } catch { /* ignore */ }

  console.log('[Snapshot] ===== captureAt (배치도) 완료 =====')
  return dataUrl
}

/**
 * 카메라를 움직이지 않고 현재 뷰포트를 그대로 캡처한다.
 * 사용자가 에디터에서 보고 있는 화면을 그대로 결과 페이지에 보여주고 싶을 때 사용.
 */
export async function captureCurrentViewDataUrl(
  viewer: AnyViewer,
  options: CaptureOptions = {},
): Promise<string> {
  console.log('[Snapshot] ===== captureCurrentViewDataUrl (조감도) 시작 =====')
  console.log('[Snapshot] 입력 options:', JSON.stringify(options))

  const Cesium = getCesium()
  if (!Cesium) throw new Error('Cesium 이 로드되지 않았습니다.')
  if (!viewer || !viewer.scene || !viewer.scene.canvas) {
    throw new Error('Cesium viewer 가 준비되지 않았습니다.')
  }
  const opts = { ...DEFAULTS, ...options }
  console.log('[Snapshot] 병합된 opts.hideOverlays:', opts.hideOverlays)

  // ========== 1단계: 그림자 설정 백업 ==========
  const shadowsEnabled = viewer.shadows
  const shadowMapEnabled = viewer.shadowMap?.enabled
  const globeLighting = viewer.scene?.globe?.enableLighting
  console.log('[Snapshot] 캡처 시작 시 그림자 설정: viewer.shadows=', shadowsEnabled,
    ', shadowMap.enabled=', shadowMapEnabled,
    ', globe.enableLighting=', globeLighting)

  // ========== 2단계: 그림자 설정 강제 활성화 (항상) ==========
  // 상태와 무관하게 항상 그림자를 활성화하여 확실하게 캡처
  console.log('[Snapshot] ★★★ 그림자 설정 강제 활성화 (항상) ★★★')

  // viewer.shadows 활성화
  viewer.shadows = true

  // shadowMap 활성화 및 설정
  if (viewer.shadowMap) {
    viewer.shadowMap.enabled = true
    // 그림자 범위 및 품질 설정
    if (viewer.shadowMap.maximumDistance < 500) {
      viewer.shadowMap.maximumDistance = 1000
    }
    viewer.shadowMap.softShadows = true

    // ★ 중요: shadowMap을 dirty 상태로 강제 설정하여 재계산 유도
    // Cesium 내부 속성이지만 그림자 맵 갱신에 필수
    if ((viewer.shadowMap as any)._dirty !== undefined) {
      ;(viewer.shadowMap as any)._dirty = true
      console.log('[Snapshot] shadowMap._dirty = true 강제 설정')
    }
    // 추가로 outOfView도 false로 설정
    if ((viewer.shadowMap as any)._outOfView !== undefined) {
      ;(viewer.shadowMap as any)._outOfView = false
    }

    console.log('[Snapshot] shadowMap 설정: enabled=', viewer.shadowMap.enabled,
      ', maximumDistance=', viewer.shadowMap.maximumDistance)
  }

  // globe lighting 활성화 (그림자 필수 조건)
  if (viewer.scene?.globe) {
    viewer.scene.globe.enableLighting = true
    console.log('[Snapshot] globe.enableLighting 활성화')
  }

  // 모든 모델 엔티티에 그림자 모드 강제 설정
  if (viewer.entities?.values) {
    for (const entity of viewer.entities.values) {
      if (entity.model) {
        const model = entity.model
        // Cesium.ShadowMode.ENABLED = 3
        if (model.shadows !== undefined) {
          const prevShadowMode = model.shadows?.getValue?.() ?? model.shadows
          model.shadows = Cesium.ShadowMode?.ENABLED ?? 3
          console.log(`[Snapshot] 엔티티 "${entity.id}" 그림자 모드: ${prevShadowMode} -> ENABLED`)
        }
      }
    }
  }

  // 3D 타일셋 (OSM 건물 등)에도 그림자 모드 강제 설정
  if (viewer.scene?.primitives) {
    const primitives = viewer.scene.primitives
    for (let i = 0; i < primitives.length; i++) {
      const prim = primitives.get(i)
      // Cesium3DTileset 인 경우 shadows 속성 설정
      if (prim && prim.shadows !== undefined) {
        prim.shadows = Cesium.ShadowMode?.ENABLED ?? 3
        console.log(`[Snapshot] Primitive ${i} 그림자 모드: ENABLED`)
      }
    }
  }

  // 태양 위치 확인 (그림자 방향 결정)
  const julianDate = viewer.clock?.currentTime
  if (julianDate) {
    console.log('[Snapshot] 현재 시간:', julianDate.toString())
  }

  // 그림자 설정 적용을 위한 강제 렌더링
  console.log('[Snapshot] 그림자 설정 후 강제 렌더링 시작')
  viewer.scene.requestRender()
  try {
    viewer.scene.render()
  } catch { /* ignore */ }

  // 그림자 맵 계산을 위한 대기
  await wait(150)

  // 두 번째 렌더 (그림자 맵 업데이트 확실히)
  viewer.scene.requestRender()
  try {
    viewer.scene.render()
  } catch { /* ignore */ }

  await wait(100)

  console.log('[Snapshot] 그림자 설정 적용 후 상태: viewer.shadows=', viewer.shadows,
    ', shadowMap.enabled=', viewer.shadowMap?.enabled)

  // ========== 3단계: 시각화 오버레이 숨기기 ==========
  let previousOverlayStates: Map<any, boolean> | null = null
  if (opts.hideOverlays) {
    console.log('[Snapshot] ★★★ 오버레이 숨김 시작 ★★★')
    previousOverlayStates = setOverlayEntitiesVisibility(viewer, false)
    console.log('[Snapshot] 숨긴 엔티티 수:', previousOverlayStates?.size || 0)

    // 엔티티 숨김 후 렌더링 요청
    viewer.scene.requestRender()
  } else {
    console.log('[Snapshot] hideOverlays=false, 오버레이 숨기지 않음')
  }

  // ========== 4단계: requestRenderMode 일시 비활성화 ==========
  // requestRenderMode가 true면 수동 렌더링이 제대로 안 될 수 있음
  const wasRequestRenderMode = viewer.scene.requestRenderMode
  console.log('[Snapshot] requestRenderMode 원래 상태:', wasRequestRenderMode)

  // 캡처 동안 연속 렌더링 모드로 전환
  viewer.scene.requestRenderMode = false
  console.log('[Snapshot] requestRenderMode = false (연속 렌더링 모드)')

  // ========== 5단계: 그림자 포함 렌더링 대기 ==========
  // 오버레이 숨김 반영 대기
  await wait(200)

  // 그림자 상태 중간 확인
  console.log('[Snapshot] 렌더링 전 그림자 상태: viewer.shadows=', viewer.shadows,
    ', shadowMap.enabled=', viewer.shadowMap?.enabled)

  // requestAnimationFrame을 사용하여 실제 브라우저 렌더 프레임 대기
  const waitForFrame = () => new Promise<void>(resolve => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resolve()
      })
    })
  })

  // 여러 프레임 렌더링하여 그림자 맵 계산 보장
  for (let i = 0; i < 5; i++) {
    viewer.scene.requestRender()
    await waitForFrame()
    await wait(50)
  }

  // 그림자 및 조명 계산을 위한 충분한 대기
  await wait(opts.settleMs || 650)

  // 최종 프레임 대기
  await waitForFrame()
  await wait(100)

  // 캡처 직전 그림자 상태 최종 확인
  console.log('[Snapshot] 캡처 직전 그림자 상태: viewer.shadows=', viewer.shadows,
    ', shadowMap.enabled=', viewer.shadowMap?.enabled)

  // ========== 6단계: 캡처 ==========
  const canvas: HTMLCanvasElement = viewer.scene.canvas

  // 마지막 렌더 요청 후 한 프레임 더 대기
  viewer.scene.requestRender()
  await waitForFrame()

  console.log('[Snapshot] 캡처 실행')
  const dataUrl = opts.mime === 'image/jpeg'
    ? canvas.toDataURL('image/jpeg', opts.quality)
    : canvas.toDataURL(opts.mime)

  // ========== 8단계: 복원 ==========
  // 시각화 오버레이 복원
  if (previousOverlayStates) {
    restoreEntityVisibility(previousOverlayStates)
    console.log('[Snapshot] 오버레이 복원 완료')
    try {
      viewer.scene.render()
    } catch { /* ignore */ }
  }

  // 그림자 설정 복원 (원래 상태로)
  console.log('[Snapshot] 그림자 설정 복원: shadows->', shadowsEnabled, ', shadowMap->', shadowMapEnabled)
  viewer.shadows = shadowsEnabled
  if (viewer.shadowMap) {
    viewer.shadowMap.enabled = shadowMapEnabled ?? true
  }
  if (viewer.scene?.globe) {
    viewer.scene.globe.enableLighting = globeLighting ?? true
  }

  // requestRenderMode 복원
  viewer.scene.requestRenderMode = wasRequestRenderMode
  console.log('[Snapshot] requestRenderMode 복원:', wasRequestRenderMode)

  // 복원 후 렌더
  try {
    viewer.scene.requestRender()
  } catch { /* ignore */ }

  console.log('[Snapshot] ===== captureCurrentViewDataUrl 완료 =====')
  return dataUrl
}

/**
 * 주어진 중심 좌표 위에서 탑다운(수직 하향) 샷을 찍는다.
 *
 * @param viewer         Cesium Viewer instance (projectStore.viewer)
 * @param longitude      중심 경도
 * @param latitude       중심 위도
 * @param altitudeMeters 카메라 높이 (m). 기본 350m — 단일 대지 규모에 맞춤
 */
export async function captureTopDownDataUrl(
  viewer: AnyViewer,
  longitude: number,
  latitude: number,
  altitudeMeters = 220,
  options: CaptureOptions = {},
): Promise<string> {
  console.log('[Snapshot] ===== captureTopDownDataUrl (배치도) 호출됨 =====')
  console.log('[Snapshot] 입력 options:', JSON.stringify(options))

  const Cesium = getCesium()
  if (!Cesium) throw new Error('Cesium 이 로드되지 않았습니다.')
  const opts = { ...DEFAULTS, ...options }
  console.log('[Snapshot] 병합된 opts.hideOverlays:', opts.hideOverlays)

  const destination = Cesium.Cartesian3.fromDegrees(
    longitude,
    latitude,
    altitudeMeters,
  )
  const orientation = {
    heading: 0,
    pitch: Cesium.Math.toRadians(-90), // 수직 하향
    roll: 0,
  }
  return captureAt(viewer, destination, orientation, { ...opts, hideOverlays: opts.hideOverlays })
}

/**
 * 45° 조감도 샷. STAGE 6 이미지 생성 AI 가 붙기 전까지는 결과 페이지에서
 * 호출하지 않지만, 나중에 참조 이미지로 넘길 수 있도록 노출해둔다.
 */
export async function captureAerialDataUrl(
  viewer: AnyViewer,
  longitude: number,
  latitude: number,
  altitudeMeters = 180,
  options: CaptureOptions = {},
): Promise<string> {
  const Cesium = getCesium()
  if (!Cesium) throw new Error('Cesium 이 로드되지 않았습니다.')
  const opts = { ...DEFAULTS, ...options }

  const destination = Cesium.Cartesian3.fromDegrees(
    longitude,
    latitude - 0.0007, // 약간 남쪽에서 북쪽을 바라보도록 (~78m)
    altitudeMeters,
  )
  const orientation = {
    heading: 0,
    pitch: Cesium.Math.toRadians(-45),
    roll: 0,
  }
  return captureAt(viewer, destination, orientation, { ...opts, hideOverlays: opts.hideOverlays })
}
