'use client'

/**
 * 학과 AI 서버에 DXF zip 업로드.
 *
 * 흐름:
 *   1) 사용자가 zip 파일 선택
 *   2) (옵션) name / auto_build / mock / limit 설정
 *   3) multipart/form-data POST /api/mlops/datasets/upload
 *   4) 응답: dataset_id + dxf_dir + (옵션) auto_build 정보
 *   5) "이 데이터로 재수집 시작" → AIJobModal(kind=collect, prefill=dxf_dir)
 *
 * XHR 사용 사유: fetch 는 업로드 진행률 추적이 어려움.
 */
import { useRef, useState } from 'react'

interface UploadResult {
  success: boolean
  dataset_id: string
  dxf_dir: string
  dxf_count: number
  size_mb: number
  auto_build: {
    job_id?: string
    pid?: number
    log_path?: string
    command?: string
    error?: string
  } | null
}

interface Props {
  aiUrl: string
  onClose: () => void
  /** 업로드 완료 시 호출. dxf_dir 을 prefill 해서 build 모달 띄우는 용도. */
  onUploaded?: (result: UploadResult) => void
}

export default function DatasetUploadModal({ aiUrl, onClose, onUploaded }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [autoBuild, setAutoBuild] = useState(false)
  const [mock, setMock] = useState(false)
  const [limit, setLimit] = useState<number | ''>('')

  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<UploadResult | null>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    if (!f.name.toLowerCase().endsWith('.zip')) {
      setError('zip 파일만 업로드 가능합니다')
      return
    }
    setFile(f)
    setError(null)
    if (!name) setName(f.name.replace(/\.zip$/i, ''))
  }

  const submit = () => {
    if (!file) {
      setError('zip 파일을 선택해주세요')
      return
    }
    setUploading(true)
    setProgress(0)
    setError(null)
    setResult(null)

    const fd = new FormData()
    fd.append('file', file)
    if (name) fd.append('name', name)
    fd.append('auto_build', String(autoBuild))
    fd.append('mock', String(mock))
    if (limit !== '') fd.append('limit', String(limit))

    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${aiUrl}/api/mlops/datasets/upload`)
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) {
        setProgress(Math.round((ev.loaded / ev.total) * 100))
      }
    }
    xhr.onload = () => {
      setUploading(false)
      try {
        const data = JSON.parse(xhr.responseText)
        if (xhr.status >= 200 && xhr.status < 300 && data.success !== false) {
          setResult(data)
          onUploaded?.(data)
        } else {
          setError(data.detail || data.error || `HTTP ${xhr.status}`)
        }
      } catch {
        setError(`응답 파싱 실패 (HTTP ${xhr.status})`)
      }
    }
    xhr.onerror = () => {
      setUploading(false)
      setError('네트워크 오류 — CORS 또는 서버 다운')
    }
    xhr.send(fd)
  }

  const fileSizeMB = file ? (file.size / (1024 * 1024)).toFixed(1) : '0'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="card max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold">📤 DXF 데이터셋 업로드</h3>
            <p className="text-xs text-white/50 mt-1">
              DXF 파일들을 zip 으로 묶어 학과 AI 서버에 업로드합니다.
            </p>
            <p className="text-xs text-white/40 mt-1 font-mono">{aiUrl}</p>
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white text-2xl leading-none">
            ×
          </button>
        </div>

        {/* 파일 선택 + 옵션 */}
        {!result && (
          <div className="space-y-4">
            <div className="text-xs text-sky-300 bg-sky-500/10 border border-sky-400/30 rounded p-2">
              ℹ DXF 파일들을 폴더 통째로 zip 으로 만든 후 업로드하세요. zip 안 폴더 구조는 평탄화됩니다.
            </div>

            {/* 파일 선택 */}
            <div>
              <label className="block text-xs text-white/60 mb-1">zip 파일</label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".zip"
                onChange={handleFileChange}
                disabled={uploading}
                className="block w-full text-sm text-white/80
                  file:mr-3 file:py-2 file:px-4
                  file:rounded file:border-0
                  file:text-sm file:font-medium
                  file:bg-blue-500/20 file:text-blue-300
                  hover:file:bg-blue-500/30
                  file:cursor-pointer cursor-pointer"
              />
              {file && (
                <p className="mt-1.5 text-xs text-white/60">
                  선택됨: <span className="font-mono">{file.name}</span> ({fileSizeMB} MB)
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs text-white/60 mb-1">데이터셋 이름 (선택)</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="예: 데이터셋2-2026spring"
                disabled={uploading}
                className="input-field text-sm"
              />
            </div>

            {/* 자동 빌드 옵션 */}
            <div className="rounded-md border border-white/10 bg-white/[0.02] p-3 space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoBuild}
                  onChange={(e) => setAutoBuild(e.target.checked)}
                  disabled={uploading}
                />
                <span className="text-sm text-white/80">
                  업로드 직후 데이터 재수집 자동 시작
                </span>
              </label>

              {autoBuild && (
                <div className="pl-6 grid grid-cols-2 gap-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={mock}
                      onChange={(e) => setMock(e.target.checked)}
                      disabled={uploading}
                    />
                    <span className="text-xs text-white/70">vLLM mock</span>
                  </label>
                  <div>
                    <label className="block text-xs text-white/60 mb-0.5">
                      처리 개수 제한
                    </label>
                    <input
                      type="number"
                      value={limit}
                      onChange={(e) =>
                        setLimit(e.target.value === '' ? '' : Number(e.target.value))
                      }
                      placeholder="(전체)"
                      disabled={uploading}
                      className="input-field text-xs"
                    />
                  </div>
                </div>
              )}

              {autoBuild && !mock && (
                <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-400/30 rounded p-2">
                  ⚠ vLLM Vision 호출 비용 발생 (DXF 1개당 ~1k token)
                </div>
              )}
            </div>

            {/* 진행률 */}
            {uploading && (
              <div>
                <div className="flex justify-between text-xs text-white/60 mb-1">
                  <span>업로드 중...</span>
                  <span>{progress}%</span>
                </div>
                <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full bg-blue-500 transition-all"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            )}

            {/* 액션 */}
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={onClose}
                disabled={uploading}
                className="btn-secondary text-sm"
              >
                취소
              </button>
              <button
                onClick={submit}
                disabled={uploading || !file}
                className="btn-primary text-sm"
              >
                {uploading ? '업로드 중...' : '업로드'}
              </button>
            </div>

            {error && (
              <div className="px-3 py-2 rounded bg-red-500/10 border border-red-500/30 text-sm text-red-300">
                {error}
              </div>
            )}
          </div>
        )}

        {/* 업로드 완료 */}
        {result && (
          <div className="space-y-3">
            <div className="px-3 py-2 rounded bg-emerald-500/10 border border-emerald-500/30 text-sm text-emerald-300">
              ✅ 업로드 완료 ({result.dxf_count}개 DXF, {result.size_mb} MB)
            </div>

            <div className="grid grid-cols-1 gap-2 text-xs">
              <Row label="데이터셋 ID" value={result.dataset_id} mono />
              <Row label="DXF 디렉토리" value={result.dxf_dir} mono />
              <Row label="파일 수" value={`${result.dxf_count} 개`} />
              <Row label="용량" value={`${result.size_mb} MB`} />
            </div>

            {result.auto_build && (
              <div className="rounded-md border border-blue-400/30 bg-blue-500/5 p-3">
                <div className="text-xs text-blue-300 font-semibold mb-1">
                  🚀 자동 빌드 시작됨
                </div>
                {result.auto_build.error ? (
                  <div className="text-xs text-red-300">{result.auto_build.error}</div>
                ) : (
                  <div className="space-y-1 text-xs">
                    <div>
                      <span className="text-white/40">job_id: </span>
                      <span className="font-mono text-white/80">
                        {result.auto_build.job_id}
                      </span>
                    </div>
                    <div>
                      <span className="text-white/40">PID: </span>
                      <span className="font-mono text-white/80">
                        {result.auto_build.pid}
                      </span>
                    </div>
                    <p className="text-[11px] text-white/50 mt-1">
                      대시보드에서 단계별 진행 확인 가능
                    </p>
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button onClick={onClose} className="btn-secondary text-sm">
                닫기
              </button>
              {!result.auto_build && (
                <button
                  onClick={() => {
                    onUploaded?.(result)
                    onClose()
                  }}
                  className="btn-primary text-sm"
                >
                  이 데이터로 재수집 시작 →
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-2">
      <span className="text-white/40 w-24 flex-shrink-0">{label}</span>
      <span className={`text-white/80 break-all ${mono ? 'font-mono' : ''}`}>
        {value}
      </span>
    </div>
  )
}
