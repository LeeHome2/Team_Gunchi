import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

// 모델 디렉토리: 환경변수 → public/models → 절대경로 순으로 탐색
const PUBLIC_MODELS_DIR = path.join(process.cwd(), 'public', 'models')
const CUSTOM_MODELS_DIR = process.env.MODELS_DIR || ''

function findModelFile(filename: string): string | null {
  // 1. public/models/ 디렉토리 확인
  const publicPath = path.join(PUBLIC_MODELS_DIR, filename)
  if (fs.existsSync(publicPath)) return publicPath

  // 2. 커스텀 디렉토리 확인 (환경변수 설정 시)
  if (CUSTOM_MODELS_DIR) {
    const customPath = path.join(CUSTOM_MODELS_DIR, filename)
    if (fs.existsSync(customPath)) return customPath
  }

  return null
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  try {
    const { filename } = await params

    // 보안: 경로 탐색 방지
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return NextResponse.json({ error: 'Invalid filename' }, { status: 400 })
    }

    // GLB 파일만 허용
    if (!filename.endsWith('.glb')) {
      return NextResponse.json({ error: 'Only GLB files are allowed' }, { status: 400 })
    }

    const filePath = findModelFile(filename)

    if (!filePath) {
      return NextResponse.json({ error: 'Model not found' }, { status: 404 })
    }

    const fileBuffer = fs.readFileSync(filePath)
    const stats = fs.statSync(filePath)

    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': 'model/gltf-binary',
        'Content-Length': stats.size.toString(),
        'Cache-Control': 'public, max-age=86400',
      },
    })
  } catch (error) {
    console.error('모델 파일 로드 실패:', error)
    return NextResponse.json(
      { error: 'Failed to load model', details: String(error) },
      { status: 500 }
    )
  }
}
