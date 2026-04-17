'use client'

import { useEffect, useState } from 'react'
import AdminTopbar from '@/components/AdminTopbar'
import {
  AdminTable,
  Tr,
  Td,
  Badge,
  SmallBtn,
} from '@/components/admin/AdminUI'
import { adminApi, AdminAIModel } from '@/lib/api'

interface TestResult {
  label: string
  confidence: number
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('ko-KR')
  } catch {
    return iso
  }
}

export default function AdminAiPage() {
  const [aiUrl, setAiUrl] = useState(
    process.env.NEXT_PUBLIC_API_URL?.replace(/:\d+$/, ':8001') ||
      'http://ceprj2.gachon.ac.kr:65006'
  )
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<TestResult[] | null>(null)
  const [log, setLog] = useState<string[]>([])
  const [models, setModels] = useState<AdminAIModel[]>([])
  const [loadingModels, setLoadingModels] = useState(true)
  const [modelError, setModelError] = useState<string | null>(null)

  const appendLog = (msg: string) => {
    const ts = new Date().toLocaleTimeString('ko-KR')
    setLog((prev) => [`[${ts}] ${msg}`, ...prev].slice(0, 20))
  }

  const loadModels = async () => {
    setLoadingModels(true)
    setModelError(null)
    try {
      const res = await adminApi.listAIModels()
      setModels(res.models)
    } catch (e: any) {
      setModelError(e.message || '모델 목록 로드 실패')
    } finally {
      setLoadingModels(false)
    }
  }

  useEffect(() => {
    loadModels()
    // Try to pull ai_url from service settings
    ;(async () => {
      try {
        const res = await adminApi.getServiceSettings()
        if (res.settings.ai_url) setAiUrl(res.settings.ai_url)
      } catch {
        /* ignore */
      }
    })()
  }, [])

  const handleTest = async () => {
    setTesting(true)
    setResult(null)
    appendLog(`POST ${aiUrl}/classify — 테스트 요청 전송`)
    try {
      const res = await fetch(`/api/classify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_id: 'admin-test',
          entities: [
            { type: 'LINE', layer: 'WALL' },
            { type: 'LINE', layer: 'DOOR' },
            { type: 'ARC', layer: 'WINDOW' },
          ],
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      // Build chart from class_counts
      const classCounts: Record<string, number> = data?.class_counts || {}
      const total = Object.values(classCounts).reduce(
        (a: number, b: any) => a + Number(b),
        0
      )
      const items = Object.entries(classCounts).map(([label, count]) => ({
        label,
        confidence: total ? Number(count) / total : 0,
      }))
      setResult(items)
      appendLog(
        `응답 ${total}건 수신 · source=${data?.is_mock ? 'mock' : 'live'} · model=${data?.model_version || '-'}`
      )
    } catch (err: any) {
      appendLog(`오류: ${err?.message || '알 수 없음'}`)
    } finally {
      setTesting(false)
    }
  }

  const handleActivate = async (m: AdminAIModel) => {
    try {
      await adminApi.activateAIModel(m.id)
      await loadModels()
    } catch (e: any) {
      alert(e.message || '활성화 실패')
    }
  }

  const handleSaveAiUrl = async () => {
    try {
      await adminApi.putServiceSetting('ai_url', aiUrl)
      appendLog(`ai_url 저장: ${aiUrl}`)
    } catch (e: any) {
      alert(e.message || '저장 실패')
    }
  }

  return (
    <>
      <AdminTopbar
        title="AI 모델 관리"
        description="학과 서버 AI 엔드포인트 연동 상태를 점검하고 모델 버전을 관리합니다."
      />
      <main className="flex-1 p-8 space-y-6">
        {/* Endpoint config */}
        <section className="card p-6">
          <h3 className="text-base font-semibold mb-4">엔드포인트 설정</h3>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-white/80">
                AI 서버 URL
              </label>
              <input
                value={aiUrl}
                onChange={(e) => setAiUrl(e.target.value)}
                className="input-field font-mono text-sm"
              />
              <p className="mt-1 text-xs text-white/40">
                DB `service_settings.ai_url`에 저장됩니다.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleTest}
                disabled={testing}
                className="btn-primary"
              >
                {testing ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  '연결 테스트'
                )}
              </button>
              <button className="btn-secondary" onClick={handleSaveAiUrl}>
                URL 저장
              </button>
            </div>
          </div>
        </section>

        {/* Result + log */}
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="card p-6">
            <h3 className="text-base font-semibold mb-4">분류 결과</h3>
            {result ? (
              <ul className="space-y-3">
                {result.map((r) => (
                  <li key={r.label}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-mono text-white/80">{r.label}</span>
                      <span className="text-white/60">
                        {(r.confidence * 100).toFixed(0)}%
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 w-full rounded-full bg-white/5">
                      <div
                        className="h-full rounded-full bg-brand-400"
                        style={{ width: `${r.confidence * 100}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-white/40">
                연결 테스트를 실행하면 분류 결과가 여기에 표시됩니다.
              </p>
            )}
          </section>

          <section className="card p-6">
            <h3 className="text-base font-semibold mb-4">로그</h3>
            <pre className="h-64 overflow-y-auto rounded-md border border-white/10 bg-navy-950 p-3 text-xs font-mono text-white/60">
              {log.length === 0 ? '로그가 비어있습니다.' : log.join('\n')}
            </pre>
          </section>
        </div>

        {/* Model version table */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold">모델 버전</h3>
            <button className="btn-secondary" onClick={loadModels}>
              새로고침
            </button>
          </div>
          {modelError && (
            <div className="card p-4 mb-3 border-red-500/30 bg-red-500/5 text-red-300 text-sm">
              {modelError}
            </div>
          )}
          <AdminTable
            headers={[
              '모델명',
              '버전',
              '알고리즘',
              '학습일',
              '정확도',
              '상태',
              '관리',
            ]}
          >
            {models.map((m) => (
              <Tr key={m.id}>
                <Td className="font-medium">{m.model_name}</Td>
                <Td className="font-mono font-semibold">{m.version}</Td>
                <Td>{m.model_type}</Td>
                <Td className="text-white/50">{formatDate(m.trained_at)}</Td>
                <Td>
                  {m.accuracy != null ? `${(m.accuracy * 100).toFixed(1)}%` : '—'}
                </Td>
                <Td>
                  {m.is_active ? (
                    <Badge variant="success">활성</Badge>
                  ) : (
                    <Badge variant="neutral">비활성</Badge>
                  )}
                </Td>
                <Td>
                  {m.is_active ? (
                    <SmallBtn>상세</SmallBtn>
                  ) : (
                    <SmallBtn
                      variant="primary"
                      onClick={() => handleActivate(m)}
                    >
                      활성화
                    </SmallBtn>
                  )}
                </Td>
              </Tr>
            ))}
            {!loadingModels && models.length === 0 && (
              <Tr>
                <Td colSpan={7} className="text-center text-white/40">
                  등록된 모델이 없습니다.
                </Td>
              </Tr>
            )}
            {loadingModels && (
              <Tr>
                <Td colSpan={7} className="text-center text-white/40">
                  불러오는 중…
                </Td>
              </Tr>
            )}
          </AdminTable>
        </section>
      </main>
    </>
  )
}
