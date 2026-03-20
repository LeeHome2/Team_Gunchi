import { NextRequest, NextResponse } from 'next/server'

const VWORLD_API_KEY = '2D8CA368-665E-34A7-8CC3-CABBDAB8DAC0'

// 용도지역 코드 → 명칭 매핑
const ZONE_CODE_MAP: Record<string, string> = {
  // 주거지역
  'UQA100': '제1종전용주거지역',
  'UQA110': '제2종전용주거지역',
  'UQA120': '제1종일반주거지역',
  'UQA121': '제2종일반주거지역',
  'UQA122': '제3종일반주거지역',
  'UQA130': '준주거지역',
  // 상업지역
  'UQA200': '중심상업지역',
  'UQA210': '일반상업지역',
  'UQA220': '근린상업지역',
  'UQA230': '유통상업지역',
  // 공업지역
  'UQA300': '전용공업지역',
  'UQA310': '일반공업지역',
  'UQA320': '준공업지역',
  // 녹지지역
  'UQA410': '보전녹지지역',
  'UQA420': '생산녹지지역',
  'UQA430': '자연녹지지역',
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

// XML에서 GeoJSON으로 변환 (용도지역용)
function xmlToGeoJSON(xmlText: string): any {
  const features: any[] = []

  // 각 featureMember 추출 (gml:featureMember)
  const memberRegex = /<gml:featureMember>([\s\S]*?)<\/gml:featureMember>/gi
  let memberMatch

  while ((memberMatch = memberRegex.exec(xmlText)) !== null) {
    const memberContent = memberMatch[1]

    // 용도지역 속성 추출
    // lt_c_uq111 (도시지역 용도지역)
    const uqNmMatch = /<lsmd:uq_nm>([^<]*)<\/lsmd:uq_nm>/i.exec(memberContent)
    const uqCdMatch = /<lsmd:uq_cd>([^<]*)<\/lsmd:uq_cd>/i.exec(memberContent)
    const pnuMatch = /<lsmd:pnu>([^<]*)<\/lsmd:pnu>/i.exec(memberContent)

    // LinearRing 내의 coordinates 또는 posList 추출
    const rings: number[][][] = []

    // 방법 1: gml:coordinates 형식
    const coordsRegex = /<gml:LinearRing[^>]*>[\s\S]*?<gml:coordinates[^>]*>([^<]+)<\/gml:coordinates>[\s\S]*?<\/gml:LinearRing>/gi
    let coordsMatch
    while ((coordsMatch = coordsRegex.exec(memberContent)) !== null) {
      const coords = parseGMLCoordinates(coordsMatch[1])
      if (coords.length > 0) {
        rings.push(coords)
      }
    }

    // 방법 2: gml:posList 형식
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

    const uqCd = uqCdMatch ? uqCdMatch[1] : null
    const uqNm = uqNmMatch ? uqNmMatch[1] : (uqCd ? ZONE_CODE_MAP[uqCd] : null)

    if (rings.length > 0 || uqCd || uqNm) {
      features.push({
        type: 'Feature',
        properties: {
          pnu: pnuMatch ? pnuMatch[1] : null,
          // 용도지역 코드 (예: UQA121)
          zoneCd: uqCd,
          // 용도지역 명칭 (예: 제2종일반주거지역)
          zoneNm: uqNm,
          // 정규화된 용도지역명
          zoneType: uqCd ? (ZONE_CODE_MAP[uqCd] || uqNm || '미지정') : '미지정',
        },
        geometry: rings.length > 0 ? {
          type: 'Polygon',
          coordinates: rings
        } : null
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
  const lon = searchParams.get('lon')
  const lat = searchParams.get('lat')

  // bbox 또는 lon/lat 중 하나는 필수
  if (!bbox && (!lon || !lat)) {
    return NextResponse.json(
      { error: 'bbox or lon/lat parameters are required' },
      { status: 400 }
    )
  }

  // 용도지역 레이어 (기본: 도시지역 용도지역)
  const layer = searchParams.get('layer') || 'lt_c_uq111'

  let wfsBbox: string

  if (bbox) {
    // bbox는 west,south,east,north 순서로 들어옴
    const [west, south, east, north] = bbox.split(',').map(Number)
    // WFS 2.0.0 BBOX는 minY,minX,maxY,maxX 순서 (EPSG:4326)
    wfsBbox = `${south},${west},${north},${east}`
  } else {
    // lon/lat으로 작은 bbox 생성 (약 100m 반경)
    const lonNum = parseFloat(lon!)
    const latNum = parseFloat(lat!)
    const delta = 0.001  // 약 100m
    wfsBbox = `${latNum - delta},${lonNum - delta},${latNum + delta},${lonNum + delta}`
  }

  const wfsUrl = `https://api.vworld.kr/req/wfs?SERVICE=WFS&VERSION=1.1.0&REQUEST=GetFeature&TYPENAME=${layer}&BBOX=${wfsBbox}&SRSNAME=EPSG:4326&KEY=${VWORLD_API_KEY}`

  console.log('Fetching zone WFS from:', wfsUrl)

  try {
    const response = await fetch(wfsUrl)

    const contentType = response.headers.get('content-type')
    console.log('Zone WFS Response status:', response.status, 'Content-Type:', contentType)

    if (!response.ok) {
      const text = await response.text()
      console.error('Zone WFS Error response:', text)
      return NextResponse.json(
        { error: 'WFS request failed', status: response.status, details: text },
        { status: response.status }
      )
    }

    const xmlText = await response.text()

    // 디버그: XML 일부 출력
    console.log('Zone WFS XML response (first 2000 chars):', xmlText.substring(0, 2000))

    // XML을 GeoJSON으로 변환
    const geojson = xmlToGeoJSON(xmlText)

    console.log(`Parsed ${geojson.features.length} zone features from WFS`)

    // 디버그 모드
    const debug = request.nextUrl.searchParams.get('debug')
    if (debug === 'true') {
      return NextResponse.json({ xml: xmlText.substring(0, 5000), geojson }, {
        headers: { 'Cache-Control': 'no-store' },
      })
    }

    // lon/lat으로 조회한 경우, 해당 점을 포함하는 용도지역만 반환
    if (lon && lat && geojson.features.length > 0) {
      // 첫 번째 결과 반환 (일반적으로 하나의 용도지역에만 속함)
      const firstZone = geojson.features[0]
      return NextResponse.json({
        zoneType: firstZone.properties.zoneType,
        zoneCd: firstZone.properties.zoneCd,
        zoneNm: firstZone.properties.zoneNm,
        feature: firstZone,
      }, {
        headers: {
          'Cache-Control': 'public, max-age=3600',
        },
      })
    }

    return NextResponse.json(geojson, {
      headers: {
        'Cache-Control': 'public, max-age=3600',
      },
    })
  } catch (error) {
    console.error('Zone WFS proxy error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch zone WFS data', details: String(error) },
      { status: 500 }
    )
  }
}
