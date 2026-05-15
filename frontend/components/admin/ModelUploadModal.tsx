'use client'

import { useState, useRef } from 'react'

interface Props {
  aiUrl: string
  onClose: () => void
  onUploaded: () => void
}

export default function ModelUploadModal({ aiUrl, onClose, onUploaded }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [modelName, setModelName] = useState('')
  const [algorithm, setAlgorithm] = useState('RandomForest')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0]
    if (selected) {
      setFile(selected)
      // 파일명에서 기본 모델 이름 추출
      if (!modelName) {
        const baseName = selected.name.replace(/\.(pkl|joblib|h5|pt|pth|onnx|zip)$/i, '')
        setModelName(baseName)
      }
    }
  }

  const handleUpload = async () => {
    if (!file) return

    setUploading(true)
    setError(null)
    setProgress(0)

    try {
      const formData = new FormData()
      formData.append('model_file', file)
      formData.append('model_name', modelName || file.name)
      formData.append('algorithm', algorithm)

      const xhr = new XMLHttpRequest()

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          setProgress(Math.round((e.loaded / e.total) * 100))
        }
      }

      await new Promise<void>((resolve, reject) => {
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve()
          } else {
            try {
              const errData = JSON.parse(xhr.responseText)
              reject(new Error(errData.detail || errData.message || `HTTP ${xhr.status}`))
            } catch {
              reject(new Error(`HTTP ${xhr.status}`))
            }
          }
        }
        xhr.onerror = () => reject(new Error('네트워크 오류'))
        xhr.open('POST', `${aiUrl}/api/mlops/models/upload`)
        xhr.send(formData)
      })

      onUploaded()
      onClose()
    } catch (e: any) {
      setError(e.message || '모델 업로드 실패')
    } finally {
      setUploading(false)
    }
  }

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-navy-800 border border-white/10 rounded-xl shadow-2xl w-full max-w-lg">
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/10">
          <h2 className="text-lg font-semibold">모델 업로드</h2>
          <p className="text-sm text-white/50 mt-1">
            학습된 모델 파일을 업로드하여 등록합니다
          </p>
        </div>

        {/* Content */}
        <div className="px-6 py-5 space-y-4">
          {/* 지원 형식 안내 */}
          <div className="p-3 rounded-lg bg-white/5 border border-white/10 text-xs text-white/60">
            <div className="font-semibold text-white/80 mb-1">지원 파일 형식</div>
            <ul className="list-disc list-inside space-y-0.5">
              <li><code>.pkl</code>, <code>.joblib</code> — scikit-learn 모델</li>
              <li><code>.h5</code> — Keras/TensorFlow 모델</li>
              <li><code>.pt</code>, <code>.pth</code> — PyTorch 모델</li>
              <li><code>.onnx</code> — ONNX 모델</li>
              <li><code>.zip</code> — 모델 + 설정 파일 묶음</li>
            </ul>
          </div>

          {/* 파일 선택 */}
          <div>
            <label className="block text-sm font-medium text-white/80 mb-1.5">
              모델 파일
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pkl,.joblib,.h5,.pt,.pth,.onnx,.zip"
              onChange={handleFileChange}
              className="hidden"
            />
            <div
              onClick={() => fileInputRef.current?.click()}
              className={`
                cursor-pointer rounded-lg border-2 border-dashed p-4 text-center transition-colors
                ${file
                  ? 'border-brand-400/50 bg-brand-500/10'
                  : 'border-white/20 hover:border-white/40 bg-white/5'
                }
              `}
            >
              {file ? (
                <div>
                  <div className="text-sm font-semibold text-white">{file.name}</div>
                  <div className="text-xs text-white/50 mt-1">
                    {formatFileSize(file.size)}
                  </div>
                </div>
              ) : (
                <div className="text-sm text-white/50">
                  클릭하여 파일 선택 또는 드래그 앤 드롭
                </div>
              )}
            </div>
          </div>

          {/* 모델 이름 */}
          <div>
            <label className="block text-sm font-medium text-white/80 mb-1.5">
              모델 이름 (버전)
            </label>
            <input
              type="text"
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              placeholder="예: my_model_v1.0"
              className="input-field"
            />
          </div>

          {/* 알고리즘 */}
          <div>
            <label className="block text-sm font-medium text-white/80 mb-1.5">
              알고리즘
            </label>
            <select
              value={algorithm}
              onChange={(e) => setAlgorithm(e.target.value)}
              className="input-field"
            >
              <option value="RandomForest">RandomForest</option>
              <option value="XGBoost">XGBoost</option>
              <option value="LightGBM">LightGBM</option>
              <option value="CNN">CNN</option>
              <option value="ResNet">ResNet</option>
              <option value="Custom">Custom</option>
            </select>
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
                  className="h-full bg-brand-500 transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {/* 에러 */}
          {error && (
            <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-sm text-red-300">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/10 flex justify-end gap-3">
          <button className="btn-secondary" onClick={onClose} disabled={uploading}>
            취소
          </button>
          <button
            className="btn-primary"
            onClick={handleUpload}
            disabled={!file || uploading}
          >
            {uploading ? '업로드 중...' : '업로드'}
          </button>
        </div>
      </div>
    </div>
  )
}
