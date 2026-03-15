import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

const MODELS_DIR = 'C:\\Users\\user\\Desktop\\26-1\\house_sample_glb'

// GLB 파일에서 바운딩 박스 크기 추출
function extractBoundingBox(filePath: string): { width: number; height: number; depth: number } | null {
  try {
    const buffer = fs.readFileSync(filePath)

    // GLB 헤더 확인
    const magic = buffer.toString('ascii', 0, 4)
    if (magic !== 'glTF') {
      return null
    }

    // JSON 청크 읽기
    const jsonChunkLength = buffer.readUInt32LE(12)
    const jsonData = buffer.toString('utf8', 20, 20 + jsonChunkLength)
    const gltf = JSON.parse(jsonData)

    // accessors에서 POSITION 찾기
    let minX = Infinity, minY = Infinity, minZ = Infinity
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity

    if (gltf.accessors) {
      for (const accessor of gltf.accessors) {
        if (accessor.min && accessor.max && accessor.type === 'VEC3') {
          minX = Math.min(minX, accessor.min[0])
          minY = Math.min(minY, accessor.min[1])
          minZ = Math.min(minZ, accessor.min[2])
          maxX = Math.max(maxX, accessor.max[0])
          maxY = Math.max(maxY, accessor.max[1])
          maxZ = Math.max(maxZ, accessor.max[2])
        }
      }
    }

    if (minX !== Infinity) {
      return {
        width: maxX - minX,   // X축 (너비)
        height: maxY - minY,  // Y축 (높이)
        depth: maxZ - minZ,   // Z축 (깊이)
      }
    }

    return null
  } catch (err) {
    console.error('바운딩 박스 추출 실패:', err)
    return null
  }
}

export async function GET() {
  try {
    const files = fs.readdirSync(MODELS_DIR)
    const glbFiles = files.filter(file => file.endsWith('.glb'))

    const models = glbFiles.map(filename => {
      const filePath = path.join(MODELS_DIR, filename)
      const stats = fs.statSync(filePath)

      // 파일명에서 모델 이름 추출 (Meshy_AI_ 제거, _texture.glb 제거)
      let displayName = filename
        .replace('Meshy_AI_', '')
        .replace('_texture.glb', '')
        .replace(/_\d+$/, '') // 끝의 숫자 제거
        .replace(/_/g, ' ')

      // 바운딩 박스 추출
      const boundingBox = extractBoundingBox(filePath)

      return {
        filename,
        displayName,
        size: stats.size,
        sizeFormatted: (stats.size / 1024 / 1024).toFixed(1) + ' MB',
        boundingBox: boundingBox || { width: 10, height: 10, depth: 10 } // 기본값
      }
    })

    return NextResponse.json({ models })
  } catch (error) {
    console.error('모델 목록 조회 실패:', error)
    return NextResponse.json(
      { error: 'Failed to list models', details: String(error) },
      { status: 500 }
    )
  }
}
