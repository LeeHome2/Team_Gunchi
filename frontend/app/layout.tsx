import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'CAD 건축 매스 생성 시스템',
  description: 'CesiumJS 기반 3D 건물 매스 생성 및 일조 분석 서비스',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  )
}
