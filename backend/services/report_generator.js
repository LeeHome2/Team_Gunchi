#!/usr/bin/env node
/**
 * 건축 배치 검토 결과 보고서 생성기
 * ─────────────────────────────────────────────────────────
 * 가천대 종합프로젝트 6조 · Building Cesium
 *
 * 사용법:
 *   node report_generator.js <input.json> <output.docx>
 *
 * 입력 JSON 스키마는 REPORT_SCHEMA.md 참고.
 * 백엔드(FastAPI)에서는 subprocess 로 이 스크립트를 호출하여
 * 보고서 docx 파일을 생성합니다.
 */

const fs = require('fs')
const path = require('path')
const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  Header,
  Footer,
  AlignmentType,
  LevelFormat,
  HeadingLevel,
  BorderStyle,
  WidthType,
  ShadingType,
  PageNumber,
  PageBreak,
  TabStopType,
  TabStopPosition,
} = require('docx')

// ─── 유틸 ────────────────────────────────────────────────
const fmtNum = (v, digits = 2) => {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  return Number(v).toLocaleString('ko-KR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

const fmtPct = (v) => {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  return `${Number(v).toFixed(2)}%`
}

const fmtCoord = (lon, lat) => {
  if (lon == null || lat == null) return '—'
  return `${Number(lon).toFixed(6)}°, ${Number(lat).toFixed(6)}°`
}

const statusLabel = (s) => {
  if (!s) return '—'
  const map = {
    pass: '적합',
    fail: '부적합',
    warning: '주의',
    ok: '적합',
    violation: '부적합',
  }
  return map[String(s).toLowerCase()] ?? s
}

const statusColor = (s) => {
  const key = String(s || '').toLowerCase()
  if (key === 'pass' || key === 'ok') return '1F7A1F' // green
  if (key === 'warning') return 'B58900' // amber
  return 'B91C1C' // red / fail
}

// ─── 스타일 / 공통 설정 ──────────────────────────────────
const CONTENT_WIDTH = 9026 // A4 with 1" margins (docx-js default)
const PRIMARY = '1F3A8A' // navy
const LIGHT_BG = 'E8EEF9' // subtle header shading
const BORDER = { style: BorderStyle.SINGLE, size: 4, color: 'BFC7D6' }
const CELL_BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER }
const CELL_MARGINS = { top: 100, bottom: 100, left: 140, right: 140 }

// ─── 빌더: 문단 / 테이블 ─────────────────────────────────
const P = (text, opts = {}) =>
  new Paragraph({
    spacing: { before: 60, after: 60 },
    ...opts,
    children: [
      new TextRun({
        text,
        font: 'Malgun Gothic',
        size: opts.size ?? 22, // 11pt
        bold: opts.bold ?? false,
        color: opts.color,
      }),
    ],
  })

const H1 = (text) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 280, after: 140 },
    children: [
      new TextRun({
        text,
        font: 'Malgun Gothic',
        size: 32, // 16pt
        bold: true,
        color: PRIMARY,
      }),
    ],
  })

const H2 = (text) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 200, after: 100 },
    children: [
      new TextRun({
        text,
        font: 'Malgun Gothic',
        size: 26, // 13pt
        bold: true,
        color: '0F172A',
      }),
    ],
  })

const cell = (text, { bold = false, bg, color, widthDxa, align } = {}) =>
  new TableCell({
    borders: CELL_BORDERS,
    margins: CELL_MARGINS,
    width: widthDxa ? { size: widthDxa, type: WidthType.DXA } : undefined,
    shading: bg ? { fill: bg, type: ShadingType.CLEAR } : undefined,
    children: [
      new Paragraph({
        alignment: align ?? AlignmentType.LEFT,
        children: [
          new TextRun({
            text: text ?? '—',
            font: 'Malgun Gothic',
            size: 22,
            bold,
            color,
          }),
        ],
      }),
    ],
  })

const kvTable = (rows, { labelCol = 2800, valueCol = CONTENT_WIDTH - 2800 } = {}) =>
  new Table({
    width: { size: labelCol + valueCol, type: WidthType.DXA },
    columnWidths: [labelCol, valueCol],
    rows: rows.map(
      ([k, v, opts = {}]) =>
        new TableRow({
          children: [
            cell(k, { bold: true, bg: LIGHT_BG, widthDxa: labelCol }),
            cell(v, { widthDxa: valueCol, color: opts.color }),
          ],
        }),
    ),
  })

// ─── 섹션 빌더 ───────────────────────────────────────────
function buildCover(data) {
  const meta = data.meta ?? {}
  const project = data.project ?? {}
  return [
    new Paragraph({ spacing: { before: 2800 } }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 160 },
      children: [
        new TextRun({
          text: '건축 배치 검토 결과 보고서',
          font: 'Malgun Gothic',
          size: 48,
          bold: true,
          color: PRIMARY,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 800 },
      children: [
        new TextRun({
          text: 'Building Cesium · DXF Placement Review',
          font: 'Malgun Gothic',
          size: 24,
          color: '475569',
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 600, after: 120 },
      children: [
        new TextRun({
          text: project.name || '(무제 프로젝트)',
          font: 'Malgun Gothic',
          size: 36,
          bold: true,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 1600 },
      children: [
        new TextRun({
          text: project.address || '주소 미지정',
          font: 'Malgun Gothic',
          size: 24,
          color: '475569',
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 2400, after: 80 },
      children: [
        new TextRun({
          text: meta.generated_at || new Date().toISOString().slice(0, 10),
          font: 'Malgun Gothic',
          size: 22,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
      children: [
        new TextRun({
          text: '가천대학교 SW 종합프로젝트 6조',
          font: 'Malgun Gothic',
          size: 22,
          bold: true,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: meta.author || '자동 생성 · Building Cesium',
          font: 'Malgun Gothic',
          size: 20,
          color: '64748B',
        }),
      ],
    }),
    new Paragraph({ children: [new PageBreak()] }),
  ]
}

function buildOverview(data) {
  const project = data.project ?? {}
  const meta = data.meta ?? {}
  return [
    H1('1. 프로젝트 개요'),
    P(
      '본 보고서는 Building Cesium 플랫폼을 통해 업로드된 DXF 도면을 기반으로 ' +
        '건물을 3D 매스로 변환하고, 선택한 대지 위에 배치한 결과를 건축 규정에 따라 ' +
        '검토한 내역을 요약한 것입니다.',
    ),
    new Paragraph({ spacing: { after: 80 } }),
    kvTable([
      ['프로젝트명', project.name || '—'],
      ['주소', project.address || '—'],
      ['작업 위치', fmtCoord(project.longitude, project.latitude)],
      ['용도지역', project.zone_type || '—'],
      ['보고서 생성일', meta.generated_at || new Date().toISOString().slice(0, 10)],
      ['담당자', meta.author || '—'],
    ]),
  ]
}

function buildSite(data) {
  const site = data.site ?? {}
  const bounds = site.bounds ?? {}
  return [
    H1('2. 대지 정보'),
    P('DXF 또는 지적도에서 추출한 대지 경계와 관련 수치입니다.'),
    new Paragraph({ spacing: { after: 80 } }),
    kvTable([
      ['대지 면적', site.area_m2 != null ? `${fmtNum(site.area_m2)} m²` : '—'],
      ['꼭짓점 수', site.vertex_count != null ? `${site.vertex_count} 개` : '—'],
      [
        '경계 X (min / max)',
        bounds.min_x != null
          ? `${fmtNum(bounds.min_x)} / ${fmtNum(bounds.max_x)}`
          : '—',
      ],
      [
        '경계 Y (min / max)',
        bounds.min_y != null
          ? `${fmtNum(bounds.min_y)} / ${fmtNum(bounds.max_y)}`
          : '—',
      ],
      [
        '중심 좌표 (WGS84)',
        fmtCoord(site.centroid_longitude, site.centroid_latitude),
      ],
    ]),
  ]
}

function buildBuilding(data) {
  const b = data.building ?? {}
  const m = b.mesh_stats ?? {}
  return [
    H1('3. 건물 정보'),
    P('AI 레이어 분류 및 외벽 추출 파이프라인으로 생성된 3D 매스 정보입니다.'),
    new Paragraph({ spacing: { after: 80 } }),
    kvTable([
      ['바닥면적', b.footprint_area_m2 != null ? `${fmtNum(b.footprint_area_m2)} m²` : '—'],
      ['건물 높이', b.height_m != null ? `${fmtNum(b.height_m, 1)} m` : '—'],
      ['층수', b.floors != null ? `${b.floors} 층` : '—'],
      ['회전각', b.rotation_deg != null ? `${fmtNum(b.rotation_deg, 1)}°` : '—'],
      ['배치 좌표', fmtCoord(b.position_longitude, b.position_latitude)],
      [
        '메쉬 통계',
        m.wall_meshes != null
          ? `외벽 ${m.wall_meshes}개 · 정점 ${m.vertices} · 면 ${m.faces}`
          : '—',
      ],
    ]),
  ]
}

function validationRow(label, value, limit, unit, status) {
  return new TableRow({
    children: [
      cell(label, { bold: true, bg: LIGHT_BG, widthDxa: 2600 }),
      cell(value != null ? `${fmtNum(value)} ${unit}` : '—', {
        widthDxa: 2300,
        align: AlignmentType.RIGHT,
      }),
      cell(limit != null ? `${fmtNum(limit)} ${unit}` : '—', {
        widthDxa: 2300,
        align: AlignmentType.RIGHT,
      }),
      cell(statusLabel(status), {
        widthDxa: CONTENT_WIDTH - 2600 - 2300 - 2300,
        bold: true,
        color: statusColor(status),
        align: AlignmentType.CENTER,
      }),
    ],
  })
}

function buildValidation(data) {
  const v = data.validation ?? {}
  const cov = v.building_coverage ?? {}
  const setback = v.setback ?? {}
  const height = v.height ?? {}
  const daylight = v.daylight ?? null

  const overallStatus = v.is_valid === true ? 'pass' : v.is_valid === false ? 'fail' : null
  const overallText = overallStatus ? statusLabel(overallStatus) : '—'

  const rows = [
    new TableRow({
      tableHeader: true,
      children: [
        cell('검토 항목', { bold: true, bg: PRIMARY, color: 'FFFFFF', widthDxa: 2600 }),
        cell('측정값', { bold: true, bg: PRIMARY, color: 'FFFFFF', widthDxa: 2300, align: AlignmentType.CENTER }),
        cell('기준 한도', { bold: true, bg: PRIMARY, color: 'FFFFFF', widthDxa: 2300, align: AlignmentType.CENTER }),
        cell('판정', {
          bold: true,
          bg: PRIMARY,
          color: 'FFFFFF',
          widthDxa: CONTENT_WIDTH - 2600 - 2300 - 2300,
          align: AlignmentType.CENTER,
        }),
      ],
    }),
    validationRow('건폐율', cov.value, cov.limit, '%', cov.status),
    validationRow('이격거리', setback.min_distance_m, setback.required_m, 'm', setback.status),
    validationRow('건물 높이', height.value_m, height.limit_m, 'm', height.status),
  ]
  if (daylight) {
    rows.push(
      validationRow(
        '일조권',
        daylight.value_m,
        daylight.required_m,
        'm',
        daylight.status,
      ),
    )
  }

  return [
    H1('4. 건축 규정 검토'),
    new Paragraph({
      spacing: { before: 60, after: 120 },
      children: [
        new TextRun({
          text: '종합 판정: ',
          font: 'Malgun Gothic',
          size: 24,
          bold: true,
        }),
        new TextRun({
          text: overallText,
          font: 'Malgun Gothic',
          size: 24,
          bold: true,
          color: statusColor(overallStatus),
        }),
      ],
    }),
    new Table({
      width: { size: CONTENT_WIDTH, type: WidthType.DXA },
      columnWidths: [2600, 2300, 2300, CONTENT_WIDTH - 2600 - 2300 - 2300],
      rows,
    }),
  ]
}

function buildViolations(data) {
  const violations = data.validation?.violations ?? []
  if (!violations.length) {
    return [
      H1('5. 위반 사항'),
      P('위반 사항이 감지되지 않았습니다.', { color: '1F7A1F' }),
    ]
  }
  const rows = [
    new TableRow({
      tableHeader: true,
      children: [
        cell('코드', { bold: true, bg: PRIMARY, color: 'FFFFFF', widthDxa: 2000 }),
        cell('내용', { bold: true, bg: PRIMARY, color: 'FFFFFF', widthDxa: CONTENT_WIDTH - 2000 }),
      ],
    }),
    ...violations.map(
      (vio) =>
        new TableRow({
          children: [
            cell(vio.code || '—', { bold: true, widthDxa: 2000 }),
            cell(vio.message || '—', { widthDxa: CONTENT_WIDTH - 2000 }),
          ],
        }),
    ),
  ]
  return [
    H1('5. 위반 사항'),
    new Table({
      width: { size: CONTENT_WIDTH, type: WidthType.DXA },
      columnWidths: [2000, CONTENT_WIDTH - 2000],
      rows,
    }),
  ]
}

function buildPipeline(data) {
  const p = data.pipeline ?? {}
  return [
    H1('6. 변환 파이프라인 요약'),
    P('DXF 업로드부터 Cesium 배치까지의 각 단계 결과입니다.'),
    new Paragraph({ spacing: { after: 80 } }),
    kvTable([
      ['① DXF 파싱', p.parsed_entities != null ? `엔티티 ${p.parsed_entities}개` : '—'],
      [
        '② AI 레이어 분류',
        p.classified_layers != null
          ? `${p.classified_layers}개 레이어 · 모델: ${p.classifier_model || 'mock-fallback'}`
          : '—',
      ],
      [
        '③ 외벽 추출 / GLB 생성',
        p.glb_size_bytes != null
          ? `${fmtNum(p.glb_size_bytes / 1024, 1)} KB`
          : '—',
      ],
      ['④ Cesium 배치', p.placement_applied ? '완료' : '—'],
      ['⑤ 규정 검토', p.validation_applied ? '완료' : '—'],
    ]),
  ]
}

function buildConclusion(data) {
  const v = data.validation ?? {}
  const passed = v.is_valid === true
  const conclusionText = passed
    ? '본 배치안은 입력된 규정 기준을 모두 충족하는 것으로 확인되었습니다. 추가 심의·인허가 단계 진행이 가능합니다.'
    : '본 배치안은 일부 규정을 충족하지 못했습니다. 위 위반 사항을 검토하여 배치 위치, 높이, 회전각 등을 조정한 뒤 재검토가 필요합니다.'

  const items = passed
    ? [
        '대지 경계와 건축선 이격거리가 기준 이상으로 확보되었는지 현장 실측으로 재확인',
        '인근 건축물 일조권 및 조망권에 대한 추가 검토 권장',
        '지정 용도지역 외 특수 규제(문화재 보호구역 등) 여부 별도 확인',
      ]
    : [
        '부적합 항목을 중심으로 배치 좌표·회전각·높이 조정 후 재시뮬레이션',
        '용도지역 기준 변경 시 기준 한도 업데이트 필요',
        '필요 시 AI 최적 배치 기능(STAGE 5)으로 대안 배치안 탐색',
      ]

  return [
    H1('7. 결론 및 권고'),
    P(conclusionText),
    new Paragraph({ spacing: { after: 80 } }),
    H2('권고 사항'),
    ...items.map(
      (t) =>
        new Paragraph({
          numbering: { reference: 'bullets', level: 0 },
          spacing: { before: 40, after: 40 },
          children: [
            new TextRun({ text: t, font: 'Malgun Gothic', size: 22 }),
          ],
        }),
    ),
    new Paragraph({ spacing: { before: 400 } }),
    P(
      '※ 본 보고서는 Building Cesium 자동 검토 결과이며, ' +
        '최종 인허가는 관할 지자체 및 건축사 확인을 통해 진행해야 합니다.',
      { color: '64748B', size: 20 },
    ),
  ]
}

// ─── 메인 ────────────────────────────────────────────────
function buildDocument(data) {
  return new Document({
    creator: '가천대 SW 종합프로젝트 6조 · Building Cesium',
    title: '건축 배치 검토 결과 보고서',
    description: 'Auto-generated placement review report',
    styles: {
      default: {
        document: {
          run: { font: 'Malgun Gothic', size: 22 },
        },
      },
      paragraphStyles: [
        {
          id: 'Heading1',
          name: 'Heading 1',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { size: 32, bold: true, color: PRIMARY, font: 'Malgun Gothic' },
          paragraph: { spacing: { before: 280, after: 140 }, outlineLevel: 0 },
        },
        {
          id: 'Heading2',
          name: 'Heading 2',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { size: 26, bold: true, font: 'Malgun Gothic' },
          paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 1 },
        },
      ],
    },
    numbering: {
      config: [
        {
          reference: 'bullets',
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: '•',
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({
                    text: 'Building Cesium · 배치 검토 보고서',
                    font: 'Malgun Gothic',
                    size: 18,
                    color: '64748B',
                  }),
                ],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
                children: [
                  new TextRun({
                    text: '가천대 SW 종합프로젝트 6조',
                    font: 'Malgun Gothic',
                    size: 18,
                    color: '64748B',
                  }),
                  new TextRun({
                    text: '\t',
                    font: 'Malgun Gothic',
                  }),
                  new TextRun({
                    children: ['Page ', PageNumber.CURRENT, ' / ', PageNumber.TOTAL_PAGES],
                    font: 'Malgun Gothic',
                    size: 18,
                    color: '64748B',
                  }),
                ],
              }),
            ],
          }),
        },
        children: [
          ...buildCover(data),
          ...buildOverview(data),
          ...buildSite(data),
          ...buildBuilding(data),
          ...buildValidation(data),
          ...buildViolations(data),
          ...buildPipeline(data),
          ...buildConclusion(data),
        ],
      },
    ],
  })
}

async function main() {
  const [, , inputPath, outputPath] = process.argv
  if (!inputPath || !outputPath) {
    console.error('usage: node report_generator.js <input.json> <output.docx>')
    process.exit(2)
  }

  const raw = fs.readFileSync(path.resolve(inputPath), 'utf8')
  const data = JSON.parse(raw)

  const doc = buildDocument(data)
  const buffer = await Packer.toBuffer(doc)
  fs.writeFileSync(path.resolve(outputPath), buffer)
  console.log(`report written: ${outputPath}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
