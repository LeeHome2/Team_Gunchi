'use client'

import { useState, useEffect, useRef } from 'react'
import {
  createProject,
  uploadAndParseDxf,
  classifyLayers,
  generateModelFromClassification,
  ParseResult,
  ClassificationResult,
  ModelResult,
} from '@/lib/analysisApi'
import { useProjectStore } from '@/store/projectStore'

// ============= Type Definitions =============

export interface AnalysisResult {
  projectId: string | null
  fileId: string
  site: { footprint: number[][]; area_sqm: number; centroid: number[]; bounds: any }
  classification: {
    total_entities: number
    class_counts: Record<string, number>
    average_confidence: number
    layers: string[]
  }
  glbUrl: string | null
  /** 백엔드에서 반환한 GLB 실제 바운딩 박스 (미터 단위) */
  boundingBox?: { width: number; depth: number; height: number }
}

interface AnalysisModalProps {
  isOpen: boolean
  onClose: () => void
  onComplete: (result: AnalysisResult) => void
  file: File | null
  anchorLonLat?: [number, number] // 모델 배치 기준 위경도
}

// ============= Step Enums =============

enum StepStatus {
  PENDING = 'pending',
  LOADING = 'loading',
  COMPLETE = 'complete',
}

// ============= Color Map =============

const LAYER_COLOR_MAP: Record<string, string> = {
  wall: 'bg-blue-100 text-blue-800 border-blue-300',
  door: 'bg-green-100 text-green-800 border-green-300',
  window: 'bg-yellow-100 text-yellow-800 border-yellow-300',
  stair: 'bg-purple-100 text-purple-800 border-purple-300',
  furniture: 'bg-orange-100 text-orange-800 border-orange-300',
  dimension: 'bg-gray-100 text-gray-800 border-gray-300',
  text: 'bg-gray-100 text-gray-800 border-gray-300',
  other: 'bg-gray-100 text-gray-800 border-gray-300',
}

const LAYER_COLOR_BAR: Record<string, string> = {
  wall: 'bg-blue-500',
  door: 'bg-green-500',
  window: 'bg-yellow-500',
  stair: 'bg-purple-500',
  furniture: 'bg-orange-500',
  dimension: 'bg-gray-400',
  text: 'bg-gray-400',
  other: 'bg-gray-400',
}

// ============= Component =============

export default function AnalysisModal({
  isOpen,
  onClose,
  onComplete,
  file,
  anchorLonLat,
}: AnalysisModalProps) {
  // ============= State Management =============

  const [currentStep, setCurrentStep] = useState(1)
  const [step1Status, setStep1Status] = useState(StepStatus.PENDING)
  const [step2Status, setStep2Status] = useState(StepStatus.PENDING)
  const [step3Status, setStep3Status] = useState(StepStatus.PENDING)

  const [parseResult, setParseResult] = useState<ParseResult | null>(null)
  const [classificationResult, setClassificationResult] =
    useState<ClassificationResult | null>(null)
  const [modelResult, setModelResult] = useState<ModelResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null)
  const isRunningRef = useRef(false)

  // ============= Main Analysis Effect =============

  useEffect(() => {
    if (!isOpen || !file) return
    // React Strict Mode에서 effect 중복 실행 방지
    if (isRunningRef.current) return
    isRunningRef.current = true

    // 새로운 분석을 시작하기 전에 이전 결과 초기화
    // (모달을 다시 열 때 직전 분석 화면이 잠깐 보이거나 stale 상태가 남는 문제 방지)
    setCurrentStep(1)
    setStep1Status(StepStatus.PENDING)
    setStep2Status(StepStatus.PENDING)
    setStep3Status(StepStatus.PENDING)
    setParseResult(null)
    setClassificationResult(null)
    setModelResult(null)
    setError(null)
    setCurrentProjectId(null)

    const runAnalysis = async () => {
      try {
        // 기존 projectId가 store에 있으면 재사용, 없으면 새로 생성
        const storeState = useProjectStore.getState()
        let projectId = storeState.projectId

        if (!projectId) {
          // DB에 프로젝트가 없으면 새로 생성
          projectId = await createProject(file.name)
          if (projectId) {
            // store에 projectId와 projectName 저장
            useProjectStore.getState().setProjectId(projectId)
            useProjectStore.getState().setProjectName(file.name.replace(/\.dxf$/i, ''))
            console.log('Project created:', projectId)
          }
        } else {
          console.log('Using existing project:', projectId)
        }

        // Step 1: Parse DXF
        setCurrentStep(1)
        setStep1Status(StepStatus.LOADING)
        setError(null)

        const parseData = await uploadAndParseDxf(file, projectId)
        setParseResult(parseData)

        // Small delay for visual feedback
        await new Promise((r) => setTimeout(r, 500))
        setStep1Status(StepStatus.COMPLETE)

        // Step 2: Classify layers (with simulated delay)
        await new Promise((r) => setTimeout(r, 800))
        setCurrentStep(2)
        setStep2Status(StepStatus.LOADING)

        const classifyData = await classifyLayers(
          parseData.file_id,
          parseData.entities,
          parseData,
          projectId,
          file?.name
        )
        setClassificationResult(classifyData)

        // Simulate classification processing time
        await new Promise((r) => setTimeout(r, 1200))
        setStep2Status(StepStatus.COMPLETE)

        // Step 3: Generate 3D model
        await new Promise((r) => setTimeout(r, 800))
        setCurrentStep(3)
        setStep3Status(StepStatus.LOADING)

        const modelData = await generateModelFromClassification(
          parseData.file_id,
          classifyData,
          parseData,
          anchorLonLat,
          file?.name,
          projectId
        )
        setModelResult(modelData)

        // Small delay for visual feedback
        await new Promise((r) => setTimeout(r, 500))
        setStep3Status(StepStatus.COMPLETE)

        // Store projectId for handleComplete
        setCurrentProjectId(projectId)

        // Analysis complete - ready for user action
        setCurrentStep(3)
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : '분석 중 오류가 발생했습니다.'
        setError(errorMessage)
        console.error('Analysis error:', err)
      } finally {
        isRunningRef.current = false
      }
    }

    runAnalysis()

    return () => {
      // cleanup — 모달이 닫히거나 file이 바뀌면 다음 실행 허용
      isRunningRef.current = false
    }
  }, [isOpen, file])

  // ============= Handlers =============

  const handleComplete = () => {
    if (
      !parseResult ||
      !classificationResult ||
      step1Status !== StepStatus.COMPLETE ||
      step2Status !== StepStatus.COMPLETE ||
      step3Status !== StepStatus.COMPLETE
    ) {
      return
    }

    const result: AnalysisResult = {
      projectId: currentProjectId || useProjectStore.getState().projectId,
      fileId: parseResult.file_id,
      site: parseResult.site,
      classification: {
        total_entities: classificationResult.total_entities,
        class_counts: classificationResult.class_counts,
        average_confidence: classificationResult.average_confidence,
        layers: classificationResult.layers,
      },
      glbUrl: modelResult?.glb_url || null,
      boundingBox: modelResult?.bounding_box || undefined,
    }

    onComplete(result)
  }

  if (!isOpen) return null

  // ============= Render =============

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[#ffffff] rounded-xl shadow-2xl max-w-2xl w-full mx-4 max-h-96 overflow-y-auto">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-8 py-6 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-[#fff]">도면 분석</h2>
            <p className="text-blue-100 text-sm mt-1">AI 기반 DXF 분석 및 3D 모델 생성</p>
          </div>
          <button
            onClick={onClose}
            disabled={
              step3Status !== StepStatus.COMPLETE &&
              step3Status !== StepStatus.PENDING
            }
            className="text-[#ffffffb3] hover:text-[#fff] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-8 space-y-6">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-red-800 text-sm font-medium">오류 발생</p>
              <p className="text-red-700 text-sm mt-1">{error}</p>
            </div>
          )}

          {/* Step 1: Parsing */}
          <Step
            number={1}
            title="도면 파싱"
            subtitle="Drawing Parsing"
            status={step1Status}
            isActive={currentStep === 1 || step1Status === StepStatus.COMPLETE}
          >
            {step1Status === StepStatus.COMPLETE && parseResult && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-3xl font-bold text-blue-600">
                    {parseResult.total_entities.toLocaleString()}
                  </span>
                  <span className="text-gray-600">개 엔티티 추출</span>
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-medium text-gray-700">레이어 목록</p>
                  <div className="flex flex-wrap gap-2">
                    {(parseResult.site?.bounds?.layers || ['WALLS', 'DOORS', 'WINDOWS', 'OTHERS']).slice(0, 5).map(
                      (layer: any, idx: number) => (
                        <span
                          key={idx}
                          className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded border border-gray-300"
                        >
                          {typeof layer === 'string' ? layer : `Layer ${idx}`}
                        </span>
                      )
                    )}
                    {(parseResult.site?.bounds?.layers?.length || 0) > 5 && (
                      <span className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded border border-gray-300">
                        +{((parseResult.site?.bounds?.layers?.length || 0) - 5)}개
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </Step>

          {/* Step 2: Classification */}
          <Step
            number={2}
            title="AI 레이어 분류"
            subtitle="AI Layer Classification"
            status={step2Status}
            isActive={
              currentStep === 2 ||
              step2Status === StepStatus.COMPLETE ||
              step1Status === StepStatus.COMPLETE
            }
          >
            {step2Status === StepStatus.COMPLETE && classificationResult && (
              <div className="space-y-4">
                {/* Classification Results */}
                <div className="space-y-3">
                  {Object.entries(classificationResult.class_counts)
                    .sort(([, a], [, b]) => b - a)
                    .map(([className, count]) => (
                      <div key={className} className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span
                            className={`px-3 py-1 rounded-full border text-xs font-medium ${
                              LAYER_COLOR_MAP[className] ||
                              'bg-gray-100 text-gray-800 border-gray-300'
                            }`}
                          >
                            {className.charAt(0).toUpperCase() +
                              className.slice(1)}
                          </span>
                          <span className="text-sm font-medium text-gray-700">
                            {count.toLocaleString()}개
                          </span>
                        </div>
                        {/* Simple bar chart */}
                        <div className="h-1.5 bg-gray-200 rounded overflow-hidden">
                          <div
                            className={`h-full ${
                              LAYER_COLOR_BAR[className] || 'bg-gray-400'
                            }`}
                            style={{
                              width: `${
                                (count /
                                  classificationResult.total_entities) *
                                100
                              }%`,
                            }}
                          ></div>
                        </div>
                      </div>
                    ))}
                </div>

                {/* Confidence */}
                <div className="border-t pt-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-700">분류 신뢰도</span>
                    <span className="text-lg font-bold text-green-600">
                      {(classificationResult.average_confidence * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="h-2 bg-gray-200 rounded-full mt-2 overflow-hidden">
                    <div
                      className="h-full bg-green-500"
                      style={{
                        width: `${classificationResult.average_confidence * 100}%`,
                      }}
                    ></div>
                  </div>
                </div>
              </div>
            )}
          </Step>

          {/* Step 3: Model Generation */}
          <Step
            number={3}
            title="3D 모델 생성"
            subtitle="3D Model Generation"
            status={step3Status}
            isActive={
              currentStep === 3 ||
              step3Status === StepStatus.COMPLETE ||
              step2Status === StepStatus.COMPLETE
            }
          >
            {step3Status === StepStatus.COMPLETE && modelResult && (
              <div className="space-y-2">
                {/* 변환 과정 단계별 표시 */}
                {modelResult.build_steps && modelResult.build_steps.length > 0 ? (
                  modelResult.build_steps.map((step, i) => (
                    <div key={i} className="flex items-start gap-3 text-sm">
                      <CheckIcon />
                      <div>
                        <span className="font-medium text-gray-800">{step.label}</span>
                        <span className="text-gray-500 ml-2">{step.detail}</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <>
                    <div className="flex items-center gap-3 text-sm">
                      <CheckIcon />
                      <span className="text-gray-700">메쉬 생성 완료</span>
                    </div>
                    <div className="flex items-center gap-3 text-sm">
                      <CheckIcon />
                      <span className="text-gray-700">GLB 변환 완료</span>
                    </div>
                  </>
                )}
                {/* 최종 메쉬 통계 */}
                <div className="bg-blue-50 rounded-lg p-3 text-sm mt-2">
                  <p className="text-gray-600">
                    메쉬: <span className="font-medium">{modelResult.mesh_stats.wall_meshes}</span>개 |
                    정점: <span className="font-medium">{modelResult.mesh_stats.vertices.toLocaleString()}</span>개 |
                    면: <span className="font-medium">{modelResult.mesh_stats.faces.toLocaleString()}</span>개
                  </p>
                </div>
              </div>
            )}
          </Step>
        </div>

        {/* Footer Actions */}
        <div className="bg-gray-50 px-8 py-4 flex gap-3 border-t">
          <button
            onClick={onClose}
            disabled={step3Status !== StepStatus.COMPLETE}
            className="flex-1 px-4 py-2 text-gray-700 bg-[#ffffff] border border-gray-300 rounded-lg hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            닫기
          </button>
          <button
            onClick={handleComplete}
            disabled={
              step3Status !== StepStatus.COMPLETE ||
              !parseResult ||
              !classificationResult
            }
            className="flex-1 px-4 py-2 bg-blue-600 text-[#fff] rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            생성완료
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 7l5 5m0 0l-5 5m5-5H6"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}

// ============= Step Component =============

interface StepProps {
  number: number
  title: string
  subtitle: string
  status: StepStatus
  isActive: boolean
  children?: React.ReactNode
}

function Step({
  number,
  title,
  subtitle,
  status,
  isActive,
  children,
}: StepProps) {
  const isComplete = status === StepStatus.COMPLETE
  const isLoading = status === StepStatus.LOADING

  return (
    <div className={`transition-opacity ${isActive ? 'opacity-100' : 'opacity-50'}`}>
      <div className="flex gap-4">
        {/* Step Circle */}
        <div className="flex-shrink-0">
          <div
            className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-[#fff] transition-all ${
              isComplete
                ? 'bg-green-500'
                : isLoading
                  ? 'bg-blue-500'
                  : 'bg-gray-300'
            }`}
          >
            {isComplete ? (
              <CheckIcon className="w-5 h-5" />
            ) : isLoading ? (
              <Spinner />
            ) : (
              number
            )}
          </div>
        </div>

        {/* Step Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <h3 className="text-lg font-semibold text-gray-800">{title}</h3>
            <span className="text-sm text-gray-500">{subtitle}</span>
          </div>

          {/* Step Details */}
          {isActive && children && (
            <div className="mt-3 text-sm text-gray-700">{children}</div>
          )}

          {/* Loading State */}
          {isLoading && !children && (
            <div className="mt-3 flex items-center gap-2 text-sm text-gray-600">
              <Spinner className="w-4 h-4" />
              <span>처리 중...</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ============= Icon Components =============

function Spinner({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg
      className={`${className} animate-spin`}
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      ></circle>
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      ></path>
    </svg>
  )
}

function CheckIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={3}
        d="M5 13l4 4L19 7"
      />
    </svg>
  )
}
