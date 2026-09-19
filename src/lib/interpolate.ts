import type { Layout, Playback, Point, Routine } from '../types'
import { layoutMemberCount } from './positions'

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function lerpPoint(a: Point, b: Point, t: number): Point {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) }
}

export function collectMovePaths(
  from: Record<number, Point>,
  to: Record<number, Point>,
  memberCount: number,
  startInset = 0,
  endInset = startInset,
  minDistance = 8,
): { key: number; x1: number; y1: number; x2: number; y2: number }[] {
  const paths: { key: number; x1: number; y1: number; x2: number; y2: number }[] = []
  for (let n = 1; n <= memberCount; n += 1) {
    const start = from[n]
    const end = to[n]
    if (!start || !end) continue
    const dx = end.x - start.x
    const dy = end.y - start.y
    const len = Math.hypot(dx, dy)
    if (len < Math.max(minDistance, startInset + endInset + 4)) continue
    const ux = dx / len
    const uy = dy / len
    paths.push({
      key: n,
      x1: start.x + ux * startInset,
      y1: start.y + uy * startInset,
      x2: end.x - ux * endInset,
      y2: end.y - uy * endInset,
    })
  }
  return paths
}

export function lineEndBeforeDot(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  radius: number,
): { x: number; y: number } {
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.hypot(dx, dy) || 1
  const pull = Math.min(radius, len)
  return { x: x2 - (dx / len) * pull, y: y2 - (dy / len) * pull }
}

export function interpolatePositions(
  from: Record<number, Point>,
  to: Record<number, Point>,
  t: number,
  memberCount: number,
): Record<number, Point> {
  const out: Record<number, Point> = {}
  const clamped = Math.min(1, Math.max(0, t))
  for (let i = 1; i <= memberCount; i += 1) {
    const a = from[i]
    const b = to[i]
    if (a && b) {
      out[i] = lerpPoint(a, b, clamped)
    } else if (a) {
      out[i] = a
    } else if (b) {
      out[i] = b
    }
  }
  return out
}

export function getDisplayPositions(
  routine: Routine,
  selectedLayoutId: string,
  playback: Playback,
): Record<number, Point> {
  const { layouts, defaultTransitionMs } = routine
  if (playback.status !== 'idle') {
    const from = layouts[playback.fromIndex]
    if (from && playback.phase === 'move') {
      const next = layouts[playback.fromIndex + 1]
      if (next) {
        const duration = layoutTransitionMs(from, defaultTransitionMs)
        const t = duration <= 0 ? 1 : playback.elapsedMs / duration
        const count = Math.max(
          layoutMemberCount(from, routine.memberCount),
          layoutMemberCount(next, routine.memberCount),
        )
        return interpolatePositions(from.positions, next.positions, t, count)
      }
    }
    if (from) return from.positions
  }
  const current = layouts.find((layout) => layout.id === selectedLayoutId) ?? layouts[0]
  return current?.positions ?? {}
}

export function getDisplayMemberCount(
  routine: Routine,
  selectedLayoutId: string,
  playback: Playback,
): number {
  const { layouts, memberCount } = routine
  if (playback.status !== 'idle' && playback.phase === 'move') {
    const from = layouts[playback.fromIndex]
    const next = layouts[playback.fromIndex + 1]
    if (from && next) {
      return Math.max(layoutMemberCount(from, memberCount), layoutMemberCount(next, memberCount))
    }
  }
  const current =
    playback.status !== 'idle'
      ? layouts[playback.fromIndex]
      : (layouts.find((layout) => layout.id === selectedLayoutId) ?? layouts[0])
  return current ? layoutMemberCount(current, memberCount) : memberCount
}

export function layoutTransitionMs(layout: Layout, fallback: number): number {
  return typeof layout.transitionMs === 'number' && Number.isFinite(layout.transitionMs)
    ? layout.transitionMs
    : fallback
}

export function layoutHoldMs(layout: Layout, fallback: number): number {
  return typeof layout.holdMs === 'number' && Number.isFinite(layout.holdMs)
    ? layout.holdMs
    : fallback
}
