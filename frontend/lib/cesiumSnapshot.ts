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
}

const DEFAULTS: Required<CaptureOptions> = {
  mime: 'image/png',
  quality: 0.92,
  settleMs: 650,
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
  options: Required<CaptureOptions>,
): Promise<string> {
  const Cesium = getCesium()
  if (!Cesium) throw new Error('Cesium 이 로드되지 않았습니다.')
  if (!viewer || !viewer.scene || !viewer.scene.canvas) {
    throw new Error('Cesium viewer 가 준비되지 않았습니다.')
  }

  // 현재 카메라 상태 백업
  const prev = {
    position: viewer.camera.position.clone(),
    direction: viewer.camera.direction.clone(),
    up: viewer.camera.up.clone(),
    right: viewer.camera.right.clone(),
  }

  // 카메라 이동 (즉시 이동 — 스크린샷이 목적이라 애니메이션 불필요)
  viewer.camera.setView({ destination, orientation })

  // 타일 렌더링 대기
  // 1) 한 프레임 명시적으로 render
  try {
    viewer.scene.render()
  } catch {
    /* ignore */
  }
  // 2) 타일 로딩 대기
  await wait(options.settleMs)
  try {
    viewer.scene.render()
  } catch {
    /* ignore */
  }

  // 캡처
  const canvas: HTMLCanvasElement = viewer.scene.canvas
  const dataUrl =
    options.mime === 'image/jpeg'
      ? canvas.toDataURL('image/jpeg', options.quality)
      : canvas.toDataURL(options.mime)

  // 원래 카메라 복원
  viewer.camera.setView({
    destination: prev.position,
    orientation: {
      direction: prev.direction,
      up: prev.up,
    },
  })
  try {
    viewer.scene.render()
  } catch {
    /* ignore */
  }

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
  const Cesium = getCesium()
  if (!Cesium) throw new Error('Cesium 이 로드되지 않았습니다.')
  const opts = { ...DEFAULTS, ...options }

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
  return captureAt(viewer, destination, orientation, opts)
}

/**
 * 45° 조감도 샷. STAGE 6 이미지 생성 AI 가 붙기 전까지는 결과 페이지에서
 * 호출하지 않지만, 나중에 참조 이미지로 넘길 수 있도록 노출해둔다.
 */
export async function captureAerialDataUrl(
  viewer: AnyViewer,
  longitude: number,
  latitude: number,
  altitudeMeters = 120,
  options: CaptureOptions = {},
): Promise<string> {
  const Cesium = getCesium()
  if (!Cesium) throw new Error('Cesium 이 로드되지 않았습니다.')
  const opts = { ...DEFAULTS, ...options }

  const destination = Cesium.Cartesian3.fromDegrees(
    longitude,
    latitude - 0.0004, // 약간 남쪽에서 북쪽을 바라보도록 (~44m)
    altitudeMeters,
  )
  const orientation = {
    heading: 0,
    pitch: Cesium.Math.toRadians(-45),
    roll: 0,
  }
  return captureAt(viewer, destination, orientation, opts)
}
