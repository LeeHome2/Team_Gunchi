import Link from 'next/link'
import Brand from './Brand'

/**
 * Marketing footer shown on landing and other public pages.
 */
export default function Footer() {
  return (
    <footer className="border-t border-white/5 bg-navy-950/60">
      <div className="mx-auto max-w-7xl px-6 py-12">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          <div className="col-span-2">
            <Brand />
            <p className="mt-4 max-w-xs text-sm text-white/50">
              Build Smarter. Verify Instantly. DXF부터 3D 매스, 규제 검토까지
              건축 설계의 전 과정을 자동화합니다.
            </p>
          </div>
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-white/40">
              Product
            </h4>
            <ul className="mt-4 space-y-2 text-sm text-white/70">
              <li>
                <Link href="/#features" className="hover:text-white">
                  Features
                </Link>
              </li>
              <li>
                <Link href="/editor" className="hover:text-white">
                  에디터
                </Link>
              </li>
              <li>
                <Link href="/projects" className="hover:text-white">
                  프로젝트
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-white/40">
              Company
            </h4>
            <ul className="mt-4 space-y-2 text-sm text-white/70">
              <li>
                <Link href="#" className="hover:text-white">
                  About
                </Link>
              </li>
              <li>
                <Link href="/admin/login" className="hover:text-white">
                  Admin
                </Link>
              </li>
              <li>
                <Link href="#" className="hover:text-white">
                  Contact
                </Link>
              </li>
            </ul>
          </div>
        </div>
        <div className="mt-10 border-t border-white/5 pt-6 text-xs text-white/40 flex justify-between flex-wrap gap-4">
          <span>© 2026 Geonchi · Gachon SW 종합프로젝트</span>
          <span>v2.4 Technical Preview</span>
        </div>
      </div>
    </footer>
  )
}
