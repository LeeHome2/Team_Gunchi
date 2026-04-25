/**
 * OpenAI gpt-image-1 (Images Edit) 프록시.
 *
 * 결과 페이지에서 캡처된 배치도/조감도를 입력으로 받아
 * 사실적인 건축 렌더링 스타일로 변환된 이미지를 반환한다.
 *
 * API 키는 서버 사이드에만 보관 (NEXT_PUBLIC_* 아님):
 *   .env.local 또는 .env 에:  OPENAI_API_KEY=sk-...
 *
 * 모델: gpt-image-1
 * 문서: https://platform.openai.com/docs/api-reference/images/createEdit
 *
 * Gemini 와 차이: 이미지/프롬프트를 multipart form 으로 업로드하고,
 * 응답은 base64 또는 URL 로 받는다 (gpt-image-1 은 항상 b64_json).
 */
import { NextRequest, NextResponse } from 'next/server'

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || ''
const MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1'
const SIZE = process.env.OPENAI_IMAGE_SIZE || '1024x1024'
const QUALITY = process.env.OPENAI_IMAGE_QUALITY || 'medium' // low | medium | high | auto

// 기본 프롬프트 — kind에 따라 분기
const DEFAULT_PROMPTS: Record<string, string> = {
  sitePlan:
    'Transform this top-down architectural site plan into a clean, professional ' +
    'master-plan rendering used by architecture firms. Calm beige/grey palette, ' +
    'subtle building shadows, clearly differentiated roads and green spaces. ' +
    'Do not add text, dimensions or labels — graphics only. Preserve the building ' +
    'placement and site geometry exactly as in the input.',
  aerialView:
    'Transform this 3D city view into a photorealistic architectural aerial ' +
    'rendering as produced by an architectural visualization studio. Bright ' +
    'natural daylight, soft shadows, realistic building textures, accurate ' +
    'reflections. Keep the surrounding context, roads, and building positions ' +
    'identical to the input. Slightly enhanced natural color saturation, no text.',
}

function stripDataUrl(dataUrl: string): { mime: string; bytes: Buffer } {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
  if (!m) {
    return { mime: 'image/png', bytes: Buffer.from(dataUrl, 'base64') }
  }
  return { mime: m[1], bytes: Buffer.from(m[2], 'base64') }
}

export async function POST(req: NextRequest) {
  if (!OPENAI_API_KEY) {
    return NextResponse.json(
      { error: 'OPENAI_API_KEY 환경변수가 설정되지 않았습니다.' },
      { status: 500 },
    )
  }

  let body: { image: string; kind?: 'sitePlan' | 'aerialView'; prompt?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '잘못된 요청 형식 (JSON 필요)' }, { status: 400 })
  }
  if (!body.image) {
    return NextResponse.json({ error: 'image (dataURL 또는 base64) 필수' }, { status: 400 })
  }

  const kind = body.kind ?? 'sitePlan'
  const prompt = body.prompt || DEFAULT_PROMPTS[kind] || DEFAULT_PROMPTS.sitePlan
  const { mime, bytes } = stripDataUrl(body.image)

  const ext = mime === 'image/jpeg' ? 'jpg' : 'png'
  const fileName = `input.${ext}`

  // multipart form 조립 (Node runtime 의 globalThis.FormData/Blob 사용)
  // Buffer → Uint8Array 로 변환 후 Blob 생성 (TS 타입 호환)
  const form = new FormData()
  const blob = new Blob([new Uint8Array(bytes)], { type: mime })
  form.append('image', blob, fileName)
  form.append('prompt', prompt)
  form.append('model', MODEL)
  form.append('n', '1')
  form.append('size', SIZE)
  form.append('quality', QUALITY)

  // 429 자동 재시도 — gpt-image-1 도 RPM/TPM 제한이 있음
  let upstream: Response | null = null
  let lastErrText = ''
  const MAX_RETRY = 3
  for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
    try {
      upstream = await fetch('https://api.openai.com/v1/images/edits', {
        method: 'POST',
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
        body: form,
      })
    } catch (e: any) {
      return NextResponse.json(
        { error: 'OpenAI 호출 예외', detail: String(e?.message ?? e) },
        { status: 500 },
      )
    }
    if (upstream.status !== 429) break
    lastErrText = await upstream.text()
    const waitMs = [1500, 4000, 9000][attempt]
    await new Promise((r) => setTimeout(r, waitMs))
  }

  if (!upstream || !upstream.ok) {
    const status = upstream?.status ?? 500
    const errText = upstream ? await upstream.text() : lastErrText
    const friendly =
      status === 429
        ? 'OpenAI 호출 한도 초과. 잠시 후 다시 시도해 주세요.'
        : status === 401
          ? 'OPENAI_API_KEY 가 유효하지 않습니다.'
          : status === 400
            ? '입력 이미지/프롬프트가 거부되었습니다.'
            : `OpenAI 호출 실패 (${status})`
    return NextResponse.json(
      { error: friendly, detail: errText.slice(0, 800), status },
      { status },
    )
  }

  const result = await upstream.json()
  // 응답 구조: { created, data: [{ b64_json: "..." }] }
  const b64: string | undefined = result?.data?.[0]?.b64_json
  if (!b64) {
    return NextResponse.json(
      {
        error: '응답에 이미지가 없습니다',
        raw: JSON.stringify(result).slice(0, 1000),
      },
      { status: 502 },
    )
  }

  return NextResponse.json({
    success: true,
    kind,
    imageDataUrl: `data:image/png;base64,${b64}`,
    promptUsed: prompt,
  })
}
