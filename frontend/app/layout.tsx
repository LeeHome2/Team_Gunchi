import type { Metadata } from 'next'
import { Inter, Noto_Sans_KR } from 'next/font/google'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
})

const notoKr = Noto_Sans_KR({
  subsets: ['latin'],
  display: 'swap',
  weight: ['400', '500', '600', '700'],
  variable: '--font-noto-kr',
})

export const metadata: Metadata = {
  title: 'Geonchi — Build Smarter. Verify Instantly.',
  description:
    'DXF 업로드 한 번으로 3D 매스와 규제 검토까지. 건축 설계의 전 과정을 자동화하는 AI 건축 지능 엔진.',
  keywords: ['건축', 'CAD', 'DXF', '3D', 'Cesium', '건축 규제', 'AI 건축'],
}

// Blocking script: apply stored theme BEFORE first paint to avoid flicker.
// Default = light mode. If user toggled to dark, localStorage wins.
const THEME_INIT_SCRIPT = `
(function(){
  try {
    var t = localStorage.getItem('geonchi.theme');
    if (t === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  } catch(e) {}
})();
`

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ko" className={`${inter.variable} ${notoKr.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="font-sans">{children}</body>
    </html>
  )
}
