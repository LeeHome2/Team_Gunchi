import { NextRequest, NextResponse } from 'next/server'

const VWORLD_API_KEY = process.env.VWORLD_API_KEY || ''

export async function GET(request: NextRequest) {
  // GetCapabilities 요청으로 사용 가능한 레이어 목록 확인
  const capabilitiesUrl = `https://api.vworld.kr/req/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities&KEY=${VWORLD_API_KEY}`

  console.log('Fetching capabilities from:', capabilitiesUrl)

  try {
    const response = await fetch(capabilitiesUrl)
    const text = await response.text()

    // Layer 이름만 추출
    const layerMatches = text.match(/<Name>([^<]+)<\/Name>/g)
    const layers = layerMatches ? layerMatches.map(m => m.replace(/<\/?Name>/g, '')) : []

    return NextResponse.json({
      url: capabilitiesUrl,
      status: response.status,
      contentType: response.headers.get('content-type'),
      layers: layers,
      fullResponse: text.substring(0, 10000),
    })
  } catch (error) {
    console.error('Capabilities error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch capabilities', details: String(error) },
      { status: 500 }
    )
  }
}
