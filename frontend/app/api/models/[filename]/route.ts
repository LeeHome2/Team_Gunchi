import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

const MODELS_DIR = 'C:\\Users\\user\\Desktop\\26-1\\house_sample_glb'

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

    const filePath = path.join(MODELS_DIR, filename)

    // 파일 존재 확인
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'Model not found' }, { status: 404 })
    }

    // GLB 파일만 허용
    if (!filename.endsWith('.glb')) {
      return NextResponse.json({ error: 'Only GLB files are allowed' }, { status: 400 })
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
