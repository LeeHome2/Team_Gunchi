import { NextRequest, NextResponse } from 'next/server'

const VWORLD_API_KEY = '2D8CA368-665E-34A7-8CC3-CABBDAB8DAC0'

// GML 좌표 문자열을 [lon, lat] 배열로 파싱
function parseGMLCoordinates(coordString: string): number[][] {
  const coords: number[][] = []
  const pairs = coordString.trim().split(' ')

  for (const pair of pairs) {
    const [lon, lat] = pair.split(',').map(Number)
    if (!isNaN(lon) && !isNaN(lat)) {
      coords.push([lon, lat])
    }
  }

  return coords
}

// posList 형식 파싱 (공백으로 구분된 좌표)
function parsePosListCoordinates(posListString: string): number[][] {
  const coords: number[][] = []
  const values = posListString.trim().split(/\s+/).map(Number)

  // lat lon 순서로 들어옴 (EPSG:4326)
  for (let i = 0; i < values.length - 1; i += 2) {
    const lat = values[i]
    const lon = values[i + 1]
    if (!isNaN(lon) && !isNaN(lat)) {
      coords.push([lon, lat])
    }
  }

  return coords
}

// XML에서 GeoJSON으로 변환
function xmlToGeoJSON(xmlText: string): any {
  const features: any[] = []

  // 각 featureMember 추출 (gml:featureMember)
  const memberRegex = /<gml:featureMember>([\s\S]*?)<\/gml:featureMember>/gi
  let memberMatch

  while ((memberMatch = memberRegex.exec(xmlText)) !== null) {
    const memberContent = memberMatch[1]

    // 속성 추출
    const pnuMatch = /<sop:pnu>([^<]*)<\/sop:pnu>/i.exec(memberContent)
    const addrMatch = /<sop:addr>([^<]*)<\/sop:addr>/i.exec(memberContent)
    const jibunMatch = /<sop:jibun>([^<]*)<\/sop:jibun>/i.exec(memberContent)
    // 지목 속성 추출 (도로 판별용)
    const jimokMatch = /<sop:jimok>([^<]*)<\/sop:jimok>/i.exec(memberContent)
    // 지목 코드 추출 (숫자 코드)
    const jimokCdMatch = /<sop:jimok_cd>([^<]*)<\/sop:jimok_cd>/i.exec(memberContent)
    // 면적 추출
    const areaMatch = /<sop:ar>([^<]*)<\/sop:ar>/i.exec(memberContent)

    // LinearRing 내의 coordinates 또는 posList 추출
    const rings: number[][][] = []

    // 방법 1: gml:coordinates 형식 (더 유연한 패턴)
    const coordsRegex = /<gml:LinearRing[^>]*>[\s\S]*?<gml:coordinates[^>]*>([^<]+)<\/gml:coordinates>[\s\S]*?<\/gml:LinearRing>/gi
    let coordsMatch
    while ((coordsMatch = coordsRegex.exec(memberContent)) !== null) {
      const coords = parseGMLCoordinates(coordsMatch[1])
      if (coords.length > 0) {
        rings.push(coords)
      }
    }

    // 방법 2: gml:posList 형식 (더 유연한 패턴)
    if (rings.length === 0) {
      const posListRegex = /<gml:LinearRing[^>]*>[\s\S]*?<gml:posList[^>]*>([^<]+)<\/gml:posList>[\s\S]*?<\/gml:LinearRing>/gi
      let posListMatch
      while ((posListMatch = posListRegex.exec(memberContent)) !== null) {
        const coords = parsePosListCoordinates(posListMatch[1])
        if (coords.length > 0) {
          rings.push(coords)
        }
      }
    }

    // 방법 3: posList가 LinearRing 없이 직접 있는 경우
    if (rings.length === 0) {
      const directPosListRegex = /<gml:posList[^>]*>([^<]+)<\/gml:posList>/gi
      let directMatch
      while ((directMatch = directPosListRegex.exec(memberContent)) !== null) {
        const coords = parsePosListCoordinates(directMatch[1])
        if (coords.length > 0) {
          rings.push(coords)
        }
      }
    }

    // 방법 4: gml:pos 형식 (개별 좌표)
    if (rings.length === 0) {
      const posRegex = /<gml:pos[^>]*>([^<]+)<\/gml:pos>/gi
      const positions: number[][] = []
      let posMatch
      while ((posMatch = posRegex.exec(memberContent)) !== null) {
        const values = posMatch[1].trim().split(/\s+/).map(Number)
        if (values.length >= 2 && !isNaN(values[0]) && !isNaN(values[1])) {
          // lat lon 순서
          positions.push([values[1], values[0]])
        }
      }
      if (positions.length > 2) {
        rings.push(positions)
      }
    }

    if (rings.length > 0) {
      const jimok = jimokMatch ? jimokMatch[1] : null
      const jimokCd = jimokCdMatch ? jimokCdMatch[1] : null

      features.push({
        type: 'Feature',
        properties: {
          pnu: pnuMatch ? pnuMatch[1] : null,
          addr: addrMatch ? addrMatch[1] : null,
          jibun: jibunMatch ? jibunMatch[1] : null,
          // 지목 정보 (도로="도", 대지="대" 등)
          jimok: jimok,
          jimokCd: jimokCd,
          // 도로 여부 판별 (지목이 "도"이면 도로)
          isRoad: jimok === '도' || jimokCd === '07',
          // 면적 (제곱미터)
          area: areaMatch ? parseFloat(areaMatch[1]) : null,
        },
        geometry: {
          type: 'Polygon',
          coordinates: rings
        }
      })
    }
  }

  return {
    type: 'FeatureCollection',
    features: features
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const bbox = searchParams.get('bbox')

  if (!bbox) {
    return NextResponse.json({ error: 'bbox parameter is required' }, { status: 400 })
  }

  // bbox는 west,south,east,north 순서로 들어옴
  const [west, south, east, north] = bbox.split(',').map(Number)

  // Vworld WFS URL - 연속지적도 레이어
  const layer = searchParams.get('layer') || 'lp_pa_cbnd_bubun'

  // WFS 2.0.0 BBOX는 minY,minX,maxY,maxX 순서 (EPSG:4326)
  const wfsBbox = `${south},${west},${north},${east}`

  const wfsUrl = `https://api.vworld.kr/req/wfs?SERVICE=WFS&VERSION=1.1.0&REQUEST=GetFeature&TYPENAME=${layer}&BBOX=${wfsBbox}&SRSNAME=EPSG:4326&KEY=${VWORLD_API_KEY}`

  console.log('Fetching cadastral WFS from:', wfsUrl)

  try {
    const response = await fetch(wfsUrl)

    const contentType = response.headers.get('content-type')
    console.log('WFS Response status:', response.status, 'Content-Type:', contentType)

    if (!response.ok) {
      const text = await response.text()
      console.error('WFS Error response:', text)
      return NextResponse.json(
        { error: 'WFS request failed', status: response.status, details: text },
        { status: response.status }
      )
    }

    const xmlText = await response.text()

    // 디버그: XML 일부 출력
    console.log('WFS XML response (first 2000 chars):', xmlText.substring(0, 2000))

    // XML을 GeoJSON으로 변환
    const geojson = xmlToGeoJSON(xmlText)

    console.log(`Parsed ${geojson.features.length} features from WFS`)

    // 디버그 모드
    const debug = request.nextUrl.searchParams.get('debug')
    if (debug === 'true') {
      return NextResponse.json({ xml: xmlText.substring(0, 5000), geojson }, {
        headers: { 'Cache-Control': 'no-store' },
      })
    }

    return NextResponse.json(geojson, {
      headers: {
        'Cache-Control': 'public, max-age=3600',
      },
    })
  } catch (error) {
    console.error('Cadastral WFS proxy error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch cadastral WFS data', details: String(error) },
      { status: 500 }
    )
  }
}
