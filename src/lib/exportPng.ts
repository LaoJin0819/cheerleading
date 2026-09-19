import type { Layout, Routine } from '../types'
import { collectMovePaths, lineEndBeforeDot } from './interpolate'
import { audienceBand, layoutMemberCount, memberFontSize, memberRadius, pathDotRadius, stageGrid } from './positions'
import { safeFilename } from './routineIo'
import { zipFiles } from './zip'

export const EXPORT_FONT = "system-ui, -apple-system, 'PingFang SC', 'Hiragino Sans GB', 'Noto Sans SC', sans-serif"

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function gridLines(width: number, height: number): string {
  const { xs, ys, stroke } = stageGrid({ width, height })
  const lines: string[] = []
  for (const x of xs) {
    lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${height}" stroke="#9aa6b2" stroke-width="${stroke}" stroke-dasharray="12 10"/>`)
  }
  for (const y of ys) {
    lines.push(`<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="#9aa6b2" stroke-width="${stroke}" stroke-dasharray="12 10"/>`)
  }
  return lines.join('')
}

export function renderLayoutSvg(routine: Routine, layout: Layout, nextLayout?: Layout | null): string {
  const { width, height } = routine.stage
  const audience = audienceBand(routine.stage)
  const radius = memberRadius(routine.stage)
  const memberCount = layoutMemberCount(layout, routine.memberCount)
  const nextCount = nextLayout ? layoutMemberCount(nextLayout, routine.memberCount) : 0
  const fontSize = memberFontSize(routine.stage, memberCount)
  const dotRadius = pathDotRadius(radius)
  const members: string[] = []
  const paths = nextLayout
    ? collectMovePaths(layout.positions, nextLayout.positions, Math.max(memberCount, nextCount), radius, 0)
    : []
  const pathLines = paths
    .map((path) => {
      const lineEnd = lineEndBeforeDot(path.x1, path.y1, path.x2, path.y2, dotRadius)
      return `<line x1="${path.x1}" y1="${path.y1}" x2="${lineEnd.x}" y2="${lineEnd.y}" fill="none" stroke="#c45c26" stroke-width="4" stroke-dasharray="16 12" stroke-linecap="round"/>
        <circle cx="${path.x2}" cy="${path.y2}" r="${dotRadius}" fill="#fff6ee" stroke="#c45c26" stroke-width="2.5"/>`
    })
    .join('')

  for (let n = 1; n <= memberCount; n += 1) {
    const point = layout.positions[n]
    if (!point) continue
    members.push(`
      <g>
        <circle cx="${point.x}" cy="${point.y}" r="${radius}" fill="#ffffff" stroke="#1c2430" stroke-width="${radius * 0.12}"/>
        <text x="${point.x}" y="${point.y}" text-anchor="middle" dominant-baseline="central"
          font-family="${escapeXml(EXPORT_FONT)}" font-size="${fontSize}" font-weight="700" fill="#1c2430">${n}</text>
      </g>`)
  }

  const layoutTitle = escapeXml(layout.name.trim() || String(layout.order))
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <clipPath id="stageClip">
      <rect width="${width}" height="${height}"/>
    </clipPath>
  </defs>
  ${gridLines(width, height)}
  <rect x="2" y="2" width="${width - 4}" height="${height - 4}" fill="none" stroke="#1c2430" stroke-width="4"/>
  <rect x="${audience.x}" y="${audience.y}" width="${audience.width}" height="${audience.height}" fill="#e6ebf0" stroke="#8a94a0" stroke-width="3"/>
  <text x="${audience.x + audience.padX}" y="${audience.y + audience.height / 2}" text-anchor="start" dominant-baseline="central"
    font-size="${audience.fontSize}" font-family="${escapeXml(EXPORT_FONT)}" font-weight="700" fill="#5c6570">${layoutTitle}</text>
  <text x="${width / 2}" y="${audience.y + audience.height / 2}" text-anchor="middle" dominant-baseline="central"
    font-size="${audience.fontSize}" font-family="${escapeXml(EXPORT_FONT)}" font-weight="700" fill="#5c6570">观众席</text>
  <g clip-path="url(#stageClip)">${pathLines}${members.join('')}</g>
</svg>`
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}

async function svgStringToPng(svg: string, scale = 2): Promise<Uint8Array> {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    img.decoding = 'sync'
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('图片生成失败'))
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.width * scale))
    canvas.height = Math.max(1, Math.round(img.height * scale))
    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) throw new Error('无法创建画布')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) resolve(result)
        else reject(new Error('PNG 导出失败'))
      }, 'image/png')
    })
    return new Uint8Array(await pngBlob.arrayBuffer())
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function exportLayoutPng(routine: Routine, layout: Layout) {
  const index = routine.layouts.findIndex((item) => item.id === layout.id)
  const svg = renderLayoutSvg(routine, layout, index >= 0 ? routine.layouts[index + 1] : undefined)
  const png = await svgStringToPng(svg)
  const name = `${safeFilename(routine.name)}-布局${String(layout.order).padStart(2, '0')}-${safeFilename(layout.name)}.png`
  downloadBlob(new Blob([png], { type: 'image/png' }), name)
}

export async function exportAllLayoutsZip(routine: Routine) {
  const files: { name: string; data: Uint8Array }[] = []
  for (let i = 0; i < routine.layouts.length; i += 1) {
    const layout = routine.layouts[i]
    const svg = renderLayoutSvg(routine, layout, routine.layouts[i + 1])
    const png = await svgStringToPng(svg)
    const name = `${String(layout.order).padStart(2, '0')}-${safeFilename(layout.name)}.png`
    files.push({ name, data: png })
  }
  const zip = zipFiles(files)
  downloadBlob(zip, `${safeFilename(routine.name)}-全部布局.zip`)
}

export function exportRoutineJson(routine: Routine) {
  const payload = JSON.stringify({ version: 1, routine }, null, 2)
  downloadBlob(new Blob([payload], { type: 'application/json' }), `${safeFilename(routine.name)}.json`)
}
