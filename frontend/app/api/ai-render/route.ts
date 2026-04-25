/**
 * Google AI Studio "Nano Banana" (Gemini 2.5 Flash Image) 프록시.
 *
 * 결과 페이지에서 캡처된 배치도/조감도를 입력으로 받아
 * 사실적인 건축 렌더링 스타일로 변환된 이미지를 반환한다.
 *
 * API 키는 서버 사이드에만 보관 (NEXT_PUBLIC_* 아님):
 *   .env.local 또는 .env 에:  GOOGLE_AI_API_KEY=...
 *
 * 모델: gemini-2.5-flash-image-preview
 * 문서: https://ai.google.dev/gemini-api/docs/image-generation
 */
import { NextRequest, NextResponse } from 'next/server'

const GOOGLE_AI_API_KEY = process.env.GOOGLE_AI_API_KEY || ''
const MODEL = process.env.NANO_BANANA_MODEL || 'gemini-2.5-flash-image-preview'
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`

// 기본 프롬프트 — kind에 따라 분기
const DEFAULT_PROMPTS: Record<string, string> = {
  sitePlan:
    '이 건축 배치도(탑다운 뷰)를 깔끔하고 전문적인 건축 도면 스타일로 변환해 주세요. ' +
    '실제 건축 사무소에서 사용하는 마스터플랜 스타일, 색상은 차분한 베이지/그레이 톤, ' +
    '건물 그림자 표현, 도로/녹지 명확하게 구분. 텍스트와 치수는 추가하지 말고 그래픽만.',
  aerialView:
    '이 3D 도시 뷰를 사실적인 건축 조감도 렌더링으로 변환해 주세요. ' +
    '맑은 낮의 자연광, 부드러운 그림자, 사실적인 건물 질감, 주변 컨텍스트 그대로 유지. ' +
    '건축 시각화 회사의 컨셉 렌더링 스타일, 약간 채도 높은 자연 색감.',
}


/**
 * dataURL("data:image/png;base64,xxx") → base64 문자열 추출
 */
function stripDataUrlPrefix(dataUrl: string): { mime: string; data: string } {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
  if (!m) {
    return { mime: 'image/png', data: dataUrl }
  }
  return { mime: m[1], data: m[2] }
}


export async function POST(req: NextRequest) {
  if (!GOOGLE_AI_API_KEY) {
    return NextResponse.json(
      { error: 'GOOGLE_AI_API_KEY 환경변수가 설정되지 않았습니다. .env.local에 추가하세요.' },
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
  const { mime, data } = stripDataUrlPrefix(body.image)

  // Gemini API 요청 본문
  const geminiRequest = {
    contents: [
      {
        parts: [
          { text: prompt },
          { inline_data: { mime_type: mime, data } },
        ],
      },
    ],
    generationConfig: {
      responseModalities: ['IMAGE'],
    },
  }

  try {
    const upstream = await fetch(`${ENDPOINT}?key=${GOOGLE_AI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiRequest),
    })

    if (!upstream.ok) {
      const errText = await upstream.text()
      return NextResponse.json(
        {
          error: `Google AI 호출 실패 (${upstream.status})`,
          detail: errText.slice(0, 500),
        },
        { status: upstream.status },
      )
    }

    const result = await upstream.json()

    // 응답에서 이미지 데이터 추출
    // result.candidates[0].content.parts[].inline_data.data
    const candidates = result?.candidates ?? []
    let imageBase64: string | null = null
    let imageMime = 'image/png'
    let textNote: string | null = null

    for (const cand of candidates) {
      const parts = cand?.content?.parts ?? []
      for (const part of parts) {
        if (part.inline_data?.data) {
          imageBase64 = part.inline_data.data
          imageMime = part.inline_data.mime_type || 'image/png'
        } else if (part.text) {
          textNote = part.text
        }
      }
      if (imageBase64) break
    }

    if (!imageBase64) {
      return NextResponse.json(
        {
          error: '응답에 이미지가 없습니다',
          textNote,
          raw: JSON.stringify(result).slice(0, 1000),
        },
        { status: 502 },
      )
    }

    return NextResponse.json({
      success: true,
      kind,
      imageDataUrl: `data:${imageMime};base64,${imageBase64}`,
      promptUsed: prompt,
      textNote,
    })
  } catch (e: any) {
    return NextResponse.json(
      { error: 'Google AI 호출 예외', detail: String(e?.message ?? e) },
      { status: 500 },
    )
  }
}
