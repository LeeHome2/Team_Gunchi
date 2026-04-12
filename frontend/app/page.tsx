import Link from 'next/link'
import LandingNav from '@/components/LandingNav'
import Footer from '@/components/Footer'

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-navy-900 text-white">
      <LandingNav />

      {/* Hero */}
      <section className="relative overflow-hidden">
        {/* Background layers */}
        <div className="absolute inset-0 bg-grid opacity-60" />
        <div className="absolute inset-0 bg-radial-glow" />
        <div className="absolute left-1/2 top-0 h-[480px] w-[980px] -translate-x-1/2 rounded-full bg-brand-500/10 blur-[120px]" />

        <div className="relative mx-auto max-w-7xl px-6 py-20 md:py-28 lg:py-32">
          <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
            {/* Left: headline */}
            <div className="animate-slide-up">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold tracking-wider text-white/70 backdrop-blur-sm">
                <span className="h-1.5 w-1.5 rounded-full bg-accent-400 animate-pulse-slow" />
                V2.4 · TECHNICAL PREVIEW
              </div>

              <h1 className="mt-6 text-5xl font-bold leading-[1.05] tracking-tight md:text-6xl lg:text-7xl text-balance">
                Build Smarter.
                <br />
                <span className="heading-gradient">Verify Instantly.</span>
              </h1>

              <p className="mt-6 max-w-xl text-lg text-white/60 text-balance">
                DXF 도면을 업로드하면 실제 지형 위에 3D 건물이 생성됩니다.
                건축 지능 엔진이 초 단위로 규제 준수 여부를 검토합니다.
              </p>

              <div className="mt-10 flex flex-wrap items-center gap-4">
                <Link href="/signup" className="btn-primary text-base px-6 py-3">
                  Start Free
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5-5 5M6 12h12" />
                  </svg>
                </Link>
                <Link href="#demo" className="btn-secondary text-base px-6 py-3">
                  <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                  Watch Demo
                </Link>
              </div>

              {/* Tiny stats */}
              <div className="mt-12 grid max-w-md grid-cols-3 gap-6 border-t border-white/5 pt-6">
                <div>
                  <div className="text-2xl font-bold text-white">98.2%</div>
                  <div className="text-xs text-white/40">규제 준수율</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-white">&lt; 30s</div>
                  <div className="text-xs text-white/40">DXF → 3D</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-white">24/7</div>
                  <div className="text-xs text-white/40">AI 검토</div>
                </div>
              </div>
            </div>

            {/* Right: wireframe visual */}
            <div className="relative animate-fade-in">
              <div className="relative aspect-square max-w-lg mx-auto">
                {/* Glow */}
                <div className="absolute inset-8 rounded-full bg-cyan-500/10 blur-3xl" />

                {/* Wireframe container */}
                <div className="relative h-full w-full rounded-2xl border border-white/10 bg-navy-850/60 backdrop-blur-md shadow-card overflow-hidden">
                  {/* Grid background */}
                  <svg
                    className="absolute inset-0 w-full h-full text-white/10"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <defs>
                      <pattern
                        id="wireGrid"
                        width="40"
                        height="40"
                        patternUnits="userSpaceOnUse"
                      >
                        <path d="M 40 0 L 0 0 0 40" fill="none" stroke="currentColor" strokeWidth="0.5" />
                      </pattern>
                    </defs>
                    <rect width="100%" height="100%" fill="url(#wireGrid)" />
                  </svg>

                  {/* Wireframe building SVG */}
                  <svg
                    className="absolute inset-0 w-full h-full"
                    viewBox="0 0 500 500"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    {/* Ground plane */}
                    <path
                      d="M80 380 L250 440 L420 380 L250 320 Z"
                      stroke="#4DD6D2"
                      strokeWidth="1.5"
                      strokeOpacity="0.5"
                    />
                    {/* Base rectangle */}
                    <path
                      d="M120 370 L250 420 L380 370 L250 320 Z"
                      fill="#4DD6D2"
                      fillOpacity="0.08"
                      stroke="#4DD6D2"
                      strokeWidth="2"
                    />
                    {/* Tower sides */}
                    <path
                      d="M120 370 L120 180 L250 130 L380 180 L380 370 L250 420 L120 370 Z"
                      stroke="#4DD6D2"
                      strokeWidth="2"
                      fill="#4DD6D2"
                      fillOpacity="0.06"
                    />
                    {/* Vertical edges */}
                    <line x1="250" y1="130" x2="250" y2="420" stroke="#4DD6D2" strokeWidth="1.5" strokeOpacity="0.7" />
                    <line x1="120" y1="180" x2="120" y2="370" stroke="#4DD6D2" strokeWidth="2" />
                    <line x1="380" y1="180" x2="380" y2="370" stroke="#4DD6D2" strokeWidth="2" />
                    {/* Floor divisions */}
                    {[220, 260, 300, 340].map((y) => (
                      <g key={y}>
                        <line x1="120" y1={y} x2="250" y2={y + 20} stroke="#4DD6D2" strokeWidth="0.8" strokeOpacity="0.5" />
                        <line x1="250" y1={y + 20} x2="380" y2={y} stroke="#4DD6D2" strokeWidth="0.8" strokeOpacity="0.5" />
                      </g>
                    ))}
                    {/* Roof top */}
                    <path
                      d="M120 180 L250 130 L380 180 L250 230 Z"
                      fill="#77E8E4"
                      fillOpacity="0.15"
                      stroke="#77E8E4"
                      strokeWidth="2"
                    />
                  </svg>

                  {/* Compliance overlay */}
                  <div className="absolute left-6 top-6 rounded-lg border border-accent-400/50 bg-navy-900/80 px-3 py-2 backdrop-blur-md shadow-glow-sm">
                    <div className="text-[10px] font-semibold tracking-wider text-accent-400 uppercase">
                      Compliance Score
                    </div>
                    <div className="mt-0.5 text-2xl font-bold text-accent-300">
                      98.2%
                    </div>
                  </div>

                  {/* Info pill */}
                  <div className="absolute bottom-6 right-6 rounded-lg border border-white/10 bg-navy-900/80 px-3 py-2 backdrop-blur-md">
                    <div className="text-[10px] text-white/40">위치</div>
                    <div className="text-xs font-medium text-white">성남시 분당구</div>
                  </div>

                  {/* Corner accents */}
                  <div className="absolute top-0 right-0 h-16 w-16 border-t-2 border-r-2 border-cyan-400/40" />
                  <div className="absolute bottom-0 left-0 h-16 w-16 border-b-2 border-l-2 border-cyan-400/40" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features section */}
      <section id="features" className="relative border-t border-white/5 py-20 md:py-28">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <div className="tag-brand inline-flex mx-auto">Features</div>
            <h2 className="mt-4 text-4xl font-bold md:text-5xl text-balance">
              설계부터 검토까지,
              <br />
              <span className="heading-gradient">하나의 파이프라인</span>
            </h2>
            <p className="mt-4 text-white/60">
              팀원이 만들고, AI가 검증하고, Cesium 위에서 즉시 확인합니다.
            </p>
          </div>

          <div className="mt-16 grid gap-6 md:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="card card-hover p-6">
                <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-lg bg-brand-500/15 border border-brand-400/30">
                  <f.icon className="h-5 w-5 text-brand-300" />
                </div>
                <h3 className="text-lg font-semibold text-white">{f.title}</h3>
                <p className="mt-2 text-sm text-white/60">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pipeline section */}
      <section id="solutions" className="relative border-t border-white/5 py-20 md:py-28">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <div className="tag-brand inline-flex mx-auto">Workflow</div>
            <h2 className="mt-4 text-4xl font-bold md:text-5xl">4단계 파이프라인</h2>
          </div>
          <div className="mt-16 grid gap-4 md:grid-cols-4">
            {PIPELINE.map((step, i) => (
              <div key={step.label} className="card p-5 relative">
                <div className="text-xs font-semibold tracking-wider text-brand-300 uppercase">
                  Step {i + 1}
                </div>
                <div className="mt-2 text-xl font-bold text-white">{step.label}</div>
                <div className="mt-1 text-sm text-white/50">{step.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative border-t border-white/5 py-20">
        <div className="mx-auto max-w-4xl px-6 text-center">
          <h2 className="text-4xl font-bold md:text-5xl text-balance">
            지금 바로 시작하세요
          </h2>
          <p className="mt-4 text-white/60">
            무료 계정 생성으로 에디터 전체 기능을 체험할 수 있습니다.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <Link href="/signup" className="btn-primary text-base px-6 py-3">
              무료로 시작하기
            </Link>
            <Link href="/editor" className="btn-secondary text-base px-6 py-3">
              에디터 둘러보기
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Content data
// ---------------------------------------------------------------------------

const FEATURES = [
  {
    title: 'DXF → 3D 매스',
    desc: 'AutoCAD DXF 도면을 업로드하면 Cesium 지형 위에 정확한 건물 매스가 생성됩니다.',
    icon: (props: any) => (
      <svg {...props} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 7l8-4 8 4v10l-8 4-8-4V7z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 7l8 4 8-4M12 11v10" />
      </svg>
    ),
  },
  {
    title: 'AI 레이어 분류',
    desc: '머신러닝 모델이 DXF 엔티티의 벽/문/창/계단을 자동으로 분류하고 라벨링합니다.',
    icon: (props: any) => (
      <svg {...props} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 2l2 5 5 .5-4 4 1.5 5.5L12 14l-4.5 3L9 11.5 5 7.5l5-.5L12 2z" />
      </svg>
    ),
  },
  {
    title: '규제 검토',
    desc: '건폐율, 용적률, 이격거리, 높이 제한을 즉시 계산하고 위반 항목을 시각화합니다.',
    icon: (props: any) => (
      <svg {...props} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
]

const PIPELINE = [
  { label: 'Upload', desc: 'DXF 업로드 또는 클라우드 가져오기' },
  { label: 'Parse', desc: '엔티티 파싱 · 레이어 분류' },
  { label: 'Generate', desc: '3D 매스 · Cesium 배치' },
  { label: 'Verify', desc: '규제 검토 · 준수율 리포트' },
]
