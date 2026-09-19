import type { Layout, Point, Routine } from '../types'
import {
  collectMovePaths,
  interpolatePositions,
  layoutHoldMs,
  layoutTransitionMs,
  lineEndBeforeDot,
} from './interpolate'
import { audienceBand, layoutMemberCount, memberFontSize, memberRadius, pathDotRadius, stageGrid } from './positions'
import { downloadBlob } from './exportPng'
import { safeFilename } from './routineIo'

const FPS = 24
const VIDEO_BITS_PER_SECOND = 1_500_000
const FONT = '"PingFang SC", "Hiragino Sans GB", "Noto Sans SC", system-ui, sans-serif'
const MIN_LAST_HOLD_MS = 400

type Segment =
  | { kind: 'hold'; index: number; duration: number }
  | { kind: 'move'; fromIndex: number; duration: number }

function even(value: number): number {
  const n = Math.max(2, Math.round(value))
  return n % 2 === 0 ? n : n + 1
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, Math.max(0, ms)))
}

function pickRecorderOptions(): { mimeType?: string; ext: string } {
  if (typeof MediaRecorder === 'undefined') {
    throw new Error('当前浏览器不支持导出视频，请换 Chrome、Edge 或 Safari 再试')
  }
  const candidates: { mimeType: string; ext: string }[] = [
    { mimeType: 'video/mp4;codecs=avc1.42E01E', ext: 'mp4' },
    { mimeType: 'video/mp4', ext: 'mp4' },
    { mimeType: 'video/webm;codecs=vp9', ext: 'webm' },
    { mimeType: 'video/webm;codecs=vp8', ext: 'webm' },
    { mimeType: 'video/webm', ext: 'webm' },
  ]
  for (const item of candidates) {
    if (MediaRecorder.isTypeSupported(item.mimeType)) return item
  }
  return { ext: 'webm' }
}

function buildTimeline(routine: Routine): Segment[] {
  const { layouts, holdMs, defaultTransitionMs } = routine
  const segments: Segment[] = []
  for (let i = 0; i < layouts.length; i += 1) {
    const hold = layoutHoldMs(layouts[i], holdMs)
    segments.push({ kind: 'hold', index: i, duration: Math.max(0, hold) })
    if (i < layouts.length - 1) {
      const move = layoutTransitionMs(layouts[i], defaultTransitionMs)
      if (move > 0) segments.push({ kind: 'move', fromIndex: i, duration: move })
    }
  }
  const last = segments[segments.length - 1]
  if (!last || last.kind !== 'hold') {
    segments.push({ kind: 'hold', index: layouts.length - 1, duration: MIN_LAST_HOLD_MS })
  } else if (last.duration < MIN_LAST_HOLD_MS) {
    last.duration = MIN_LAST_HOLD_MS
  }
  return segments.filter((segment) => segment.duration > 0)
}

function layoutLabel(layout: Layout): string {
  return layout.name.trim() || String(layout.order)
}

function segmentSubtitle(routine: Routine, segment: Segment): string {
  if (segment.kind === 'hold') {
    return layoutLabel(routine.layouts[segment.index])
  }
  const from = routine.layouts[segment.fromIndex]
  const to = routine.layouts[segment.fromIndex + 1]
  if (!from || !to) return ''
  return `${layoutLabel(from)} → ${layoutLabel(to)}`
}

function frameState(routine: Routine, segment: Segment, t: number): {
  positions: Record<number, Point>
  memberCount: number
} {
  if (segment.kind === 'hold') {
    const layout = routine.layouts[segment.index]
    return {
      positions: layout.positions,
      memberCount: layoutMemberCount(layout, routine.memberCount),
    }
  }
  const from = routine.layouts[segment.fromIndex]
  const to = routine.layouts[segment.fromIndex + 1]
  const memberCount = Math.max(
    layoutMemberCount(from, routine.memberCount),
    layoutMemberCount(to, routine.memberCount),
  )
  return {
    positions: interpolatePositions(from.positions, to.positions, t, memberCount),
    memberCount,
  }
}

function drawFrame(
  ctx: CanvasRenderingContext2D,
  routine: Routine,
  positions: Record<number, Point>,
  memberCount: number,
  subtitle: string,
  scale: number,
  pathTargets: Record<number, Point> | null,
) {
  const audience = audienceBand(routine.stage)
  const { width, height } = routine.stage
  ctx.setTransform(scale, 0, 0, scale, 0, 0)
  ctx.fillStyle = '#eef3f8'
  ctx.fillRect(0, 0, width, height)

  ctx.strokeStyle = '#9aa6b2'
  ctx.setLineDash([12, 10])
  const { xs, ys, stroke } = stageGrid(routine.stage)
  ctx.lineWidth = stroke
  ctx.beginPath()
  for (const x of xs) {
    ctx.moveTo(x, 0)
    ctx.lineTo(x, height)
  }
  for (const y of ys) {
    ctx.moveTo(0, y)
    ctx.lineTo(width, y)
  }
  ctx.stroke()
  ctx.setLineDash([])

  ctx.strokeStyle = '#1c2430'
  ctx.lineWidth = 4
  ctx.strokeRect(2, 2, width - 4, height - 4)

  ctx.fillStyle = '#e6ebf0'
  ctx.strokeStyle = '#8a94a0'
  ctx.lineWidth = 3
  ctx.fillRect(audience.x, audience.y, audience.width, audience.height)
  ctx.strokeRect(audience.x, audience.y, audience.width, audience.height)
  ctx.fillStyle = '#5c6570'
  ctx.font = `700 ${audience.fontSize}px ${FONT}`
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.fillText(subtitle, audience.x + audience.padX, audience.y + audience.height / 2)
  ctx.textAlign = 'center'
  ctx.fillText('观众席', width / 2, audience.y + audience.height / 2)

  const radius = memberRadius(routine.stage)
  const fontSize = memberFontSize(routine.stage, memberCount)
  const dotRadius = pathDotRadius(radius)
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, width, height)
  ctx.clip()

  if (pathTargets) {
    const nextCount = Math.max(memberCount, ...Object.keys(pathTargets).map(Number), 0)
    const paths = collectMovePaths(positions, pathTargets, nextCount, radius, 0)
    if (paths.length) {
      ctx.strokeStyle = '#c45c26'
      ctx.lineWidth = 4
      ctx.setLineDash([16, 12])
      ctx.lineCap = 'round'
      ctx.beginPath()
      for (const path of paths) {
        const lineEnd = lineEndBeforeDot(path.x1, path.y1, path.x2, path.y2, dotRadius)
        ctx.moveTo(path.x1, path.y1)
        ctx.lineTo(lineEnd.x, lineEnd.y)
      }
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = '#fff6ee'
      ctx.strokeStyle = '#c45c26'
      ctx.lineWidth = 2.5
      for (const path of paths) {
        ctx.beginPath()
        ctx.arc(path.x2, path.y2, dotRadius, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
      }
    }
  }

  ctx.font = `700 ${fontSize}px ${FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (let n = 1; n <= memberCount; n += 1) {
    const point = positions[n]
    if (!point) continue
    ctx.beginPath()
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2)
    ctx.fillStyle = '#ffffff'
    ctx.fill()
    ctx.lineWidth = radius * 0.12
    ctx.strokeStyle = '#1c2430'
    ctx.stroke()
    ctx.fillStyle = '#1c2430'
    ctx.fillText(String(n), point.x, point.y)
  }
  ctx.restore()
}

export async function exportRoutineVideo(
  routine: Routine,
  onProgress?: (ratio: number) => void,
): Promise<void> {
  if (!routine.layouts.length) throw new Error('没有可导出的布局')
  if (typeof MediaRecorder === 'undefined' || typeof HTMLCanvasElement === 'undefined') {
    throw new Error('当前浏览器不支持导出视频')
  }

  const options = pickRecorderOptions()
  const srcW = routine.stage.width
  const srcH = routine.stage.height
  const scale = Math.min(1, 1920 / srcW, 1080 / srcH)
  const canvas = document.createElement('canvas')
  canvas.width = even(srcW * scale)
  canvas.height = even(srcH * scale)
  canvas.style.position = 'fixed'
  canvas.style.left = '-99999px'
  canvas.style.top = '0'
  canvas.style.pointerEvents = 'none'
  document.body.appendChild(canvas)

  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true })
  if (!ctx) {
    canvas.remove()
    throw new Error('无法创建画布')
  }

  const stream = canvas.captureStream(FPS)
  const track = stream.getVideoTracks()[0]
  const recorder = (() => {
    try {
      return options.mimeType
        ? new MediaRecorder(stream, { mimeType: options.mimeType, videoBitsPerSecond: VIDEO_BITS_PER_SECOND })
        : new MediaRecorder(stream, { videoBitsPerSecond: VIDEO_BITS_PER_SECOND })
    } catch {
      return new MediaRecorder(stream)
    }
  })()
  const chunks: Blob[] = []
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data)
  }

  const segments = buildTimeline(routine)
  const frameMs = 1000 / FPS
  const totalFrames = Math.max(1, segments.reduce((sum, segment) => sum + Math.max(1, Math.round(segment.duration / frameMs)), 0))

  const paint = (segment: Segment, t: number) => {
    const frame = frameState(routine, segment, t)
    const index = segment.kind === 'hold' ? segment.index : segment.fromIndex
    const pathTargets = routine.layouts[index + 1]?.positions ?? null
    drawFrame(ctx, routine, frame.positions, frame.memberCount, segmentSubtitle(routine, segment), scale, pathTargets)
    const requestFrame = (track as MediaStreamTrack & { requestFrame?: () => void }).requestFrame
    requestFrame?.call(track)
  }

  if (document.fonts?.ready) {
    await document.fonts.ready.catch(() => undefined)
  }

  const first = segments[0]
  paint(first, 0)
  onProgress?.(0)

  const stopped = new Promise<Blob>((resolve, reject) => {
    recorder.onerror = () => reject(new Error('视频录制失败'))
    recorder.onstop = () => {
      const type = recorder.mimeType || options.mimeType || 'video/webm'
      resolve(new Blob(chunks, { type }))
    }
  })

  try {
    recorder.start(200)
    await sleep(frameMs)

    let doneFrames = 0
    let nextAt = performance.now()
    for (const segment of segments) {
      const frames = Math.max(1, Math.round(segment.duration / frameMs))
      for (let i = 0; i < frames; i += 1) {
        const t = frames <= 1 ? 1 : i / frames
        paint(segment, t)
        doneFrames += 1
        onProgress?.(Math.min(1, doneFrames / totalFrames))
        nextAt += frameMs
        const wait = nextAt - performance.now()
        if (wait > 0) await sleep(wait)
        else await sleep(0)
      }
    }

    onProgress?.(1)
    await sleep(frameMs * 2)
    if (recorder.state !== 'inactive') recorder.stop()
    const blob = await stopped
    if (blob.size < 64) throw new Error('视频文件为空，请换一个浏览器再试')
    const ext = blob.type.includes('mp4') ? 'mp4' : options.ext
    downloadBlob(blob, `${safeFilename(routine.name)}-变换过程.${ext}`)
  } finally {
    track.stop()
    stream.getTracks().forEach((item) => item.stop())
    canvas.remove()
    if (recorder.state !== 'inactive') {
      try {
        recorder.stop()
      } catch {
        // already stopped
      }
    }
  }
}
