/**
 * Google Gemini (Nano Banana) 이미지 생성 프록시.
 *
 * gpt-image-1 과 동일한 인터페이스로 Gemini 이미지 생성 API 호출.
 *
 * 환경변수:
 *   GEMINI_API_KEY=AIza...
 *   GEMINI_IMAGE_MODEL=gemini-2.0-flash-exp (기본값)
 */
import { NextRequest, NextResponse } from 'next/server'

const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || ''
const MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image'

// 스타일 앵커 (환경변수로 base64 제공 시 사용)
const STYLE_ANCHORS: Record<string, string> = {
  sitePlan: process.env.ANCHOR_SITEPLAN_B64 || '',
  aerialView: process.env.ANCHOR_AERIAL_B64 || '',
}

// 고정 프롬프트 — 버전 6: 배치도는 초록 경계 유지, 조감도는 제거
const FIXED_SITEPLAN = `Architectural site plan rendering. Keep EXACT composition. Main building area with GREEN OUTLINE. Realistic buildings, roads, landscaping. NO text/labels.`

const FIXED_AERIAL = `Architectural aerial rendering. Keep EXACT camera angle. Keep building SAME size and height as input. Realistic facades and roads. NO text/labels. Golden hour lighting.`


interface RenderContext {
  zoneType?: string
  floors?: number
  heightM?: number
  sunlightHours?: number
  buildingCoverage?: number
}

function buildPrompt(kind: string, context?: RenderContext): string {
  let p = kind === 'sitePlan' ? FIXED_SITEPLAN : FIXED_AERIAL

  if (context?.zoneType) {
    p += `\n\nContext: ${context.zoneType} zone building.`
  }
  if (context?.floors) {
    p += ` ${context.floors} floors.`
  }
  if (context?.sunlightHours !== undefined) {
    const lighting = context.sunlightHours > 5
      ? 'bright sunny daylight'
      : context.sunlightHours > 3
        ? 'soft afternoon light'
        : 'overcast diffuse light'
    p += ` Render with ${lighting}.`
  }

  return p
}


export async function POST(req: NextRequest) {
  if (!GEMINI_KEY) {
    return NextResponse.json(
      { error: 'GEMINI_API_KEY 환경변수가 설정되지 않았습니다.' },
      { status: 500 },
    )
  }

  let body: {
    image: string
    kind?: 'sitePlan' | 'aerialView'
    prompt?: string
    context?: RenderContext
  }

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '잘못된 요청 형식 (JSON 필요)' }, { status: 400 })
  }

  if (!body.image) {
    return NextResponse.json({ error: 'image (dataURL 또는 base64) 필수' }, { status: 400 })
  }

  const kind = body.kind ?? 'sitePlan'
  const promptText = body.prompt || buildPrompt(kind, body.context)

  // 이미지 base64 추출
  const m = body.image.match(/^data:([^;]+);base64,(.+)$/)
  const mimeType = m ? m[1] : 'image/png'
  const inputB64 = m ? m[2] : body.image

  // 요청 parts 구성
  const parts: any[] = [{ text: promptText }]

  // 스타일 앵커가 있으면 [앵커, 입력] 순서로 다중 이미지
  if (STYLE_ANCHORS[kind]) {
    parts.push({ text: '\nFIRST image = style reference. SECOND image = transform target.' })
    parts.push({ inlineData: { mimeType: 'image/png', data: STYLE_ANCHORS[kind] } })
  }
  parts.push({ inlineData: { mimeType, data: inputB64 } })

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_KEY}`

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          temperature: 0.1,
          responseModalities: ['TEXT', 'IMAGE'],
        },
      }),
    })
  } catch (e: any) {
    return NextResponse.json(
      { error: 'Gemini 호출 예외', detail: String(e?.message ?? e) },
      { status: 500 },
    )
  }

  if (!response.ok) {
    const errText = await response.text()
    return NextResponse.json(
      { error: `Gemini 호출 실패 (${response.status})`, detail: errText.slice(0, 800) },
      { status: response.status },
    )
  }

  const data = await response.json()

  // 응답에서 이미지 part 찾기
  const candidates = data?.candidates?.[0]?.content?.parts || []
  const imagePart = candidates.find((p: any) => p.inlineData?.data)

  if (!imagePart) {
    return NextResponse.json(
      {
        error: '응답에 이미지가 없습니다',
        raw: JSON.stringify(data).slice(0, 500)
      },
      { status: 502 },
    )
  }

  return NextResponse.json({
    success: true,
    kind,
    imageDataUrl: `data:${imagePart.inlineData.mimeType || 'image/png'};base64,${imagePart.inlineData.data}`,
    promptUsed: promptText,
    backend: 'gemini',
  })
}
