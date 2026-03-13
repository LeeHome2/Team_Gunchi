import { NextRequest, NextResponse } from 'next/server'

const VWORLD_API_KEY = '2D8CA368-665E-34A7-8CC3-CABBDAB8DAC0'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const bbox = searchParams.get('bbox')
  const width = searchParams.get('width') || '1024'
  const height = searchParams.get('height') || '1024'
  const debug = searchParams.get('debug')

  if (!bbox) {
    return NextResponse.json({ error: 'bbox parameter is required' }, { status: 400 })
  }

  // bbox는 west,south,east,north 순서로 들어옴
  const [west, south, east, north] = bbox.split(',').map(Number)

  // Vworld WMS URL - 연속지적도 레이어
  // WMS 1.3.0 사용 (EPSG:4326은 lat,lon 순서: minY,minX,maxY,maxX)
  // 레이어: lp_pa_cbnd_bubun (지적경계 분할), lp_pa_cbnd_bonbun (지적경계 본번)
  const layer = searchParams.get('layer') || 'lp_pa_cbnd_bubun'
  const wmsBbox = `${south},${west},${north},${east}`
  const wmsUrl = `https://api.vworld.kr/req/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=${layer}&STYLES=&FORMAT=image/png&TRANSPARENT=true&CRS=EPSG:4326&BBOX=${wmsBbox}&WIDTH=${width}&HEIGHT=${height}&KEY=${VWORLD_API_KEY}`

  console.log('Fetching cadastral from:', wmsUrl)

  try {
    const response = await fetch(wmsUrl, {
      headers: {
        'Accept': 'image/png,image/*,*/*',
      },
    })

    const contentType = response.headers.get('content-type')
    console.log('Response status:', response.status, 'Content-Type:', contentType)

    // Debug mode - return full response info
    if (debug === 'true') {
      const text = await response.text()
      return NextResponse.json({
        url: wmsUrl,
        status: response.status,
        contentType,
        body: text.substring(0, 5000),
      })
    }

    // Check if response is an image
    if (contentType && contentType.includes('image')) {
      const imageBuffer = await response.arrayBuffer()

      return new NextResponse(imageBuffer, {
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=3600',
        },
      })
    } else {
      // If not an image, log the response text for debugging
      const text = await response.text()
      console.error('Vworld returned non-image response:', text)

      return NextResponse.json(
        { error: 'Vworld API did not return an image', details: text, url: wmsUrl },
        { status: 500 }
      )
    }
  } catch (error) {
    console.error('Cadastral proxy error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch cadastral data', details: String(error) },
      { status: 500 }
    )
  }
}
