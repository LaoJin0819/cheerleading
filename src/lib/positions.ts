import type { Layout, Point, StageSize } from '../types'
import { createId } from './ids'

export const DEFAULT_STAGE: StageSize = { width: 1600, height: 900 }
export const MIN_STAGE = 400
export const MAX_STAGE = 4000
export const DEFAULT_GRID_COLS = 6
export const DEFAULT_GRID_ROWS = 2
export const DEFAULT_MEMBER_COUNT = DEFAULT_GRID_COLS * DEFAULT_GRID_ROWS
export const MIN_MEMBER_COUNT = 1
export const MAX_MEMBER_COUNT = 60
export const MIN_GRID = 1
export const MAX_GRID = 20
export const STAGE_GRID_X = 16
export const STAGE_GRID_Y = 12
export const STAGE_GRID_STROKE = 2
export const DEFAULT_TRANSITION_MS = 1500
export const DEFAULT_HOLD_MS = 400

export function clampStage(width: number, height: number): StageSize {
  return {
    width: Math.min(MAX_STAGE, Math.max(MIN_STAGE, Math.round(width))),
    height: Math.min(MAX_STAGE, Math.max(MIN_STAGE, Math.round(height))),
  }
}

export function clampGrid(cols: number, rows: number): { cols: number; rows: number } {
  let nextCols = Math.min(MAX_GRID, Math.max(MIN_GRID, Math.round(cols)))
  let nextRows = Math.min(MAX_GRID, Math.max(MIN_GRID, Math.round(rows)))
  while (nextCols * nextRows > MAX_MEMBER_COUNT) {
    if (nextCols >= nextRows) nextCols -= 1
    else nextRows -= 1
  }
  return { cols: Math.max(MIN_GRID, nextCols), rows: Math.max(MIN_GRID, nextRows) }
}

export function inferGrid(memberCount: number): { cols: number; rows: number } {
  const count = Math.min(MAX_MEMBER_COUNT, Math.max(MIN_MEMBER_COUNT, Math.round(memberCount)))
  if (count % 2 === 0 && count / 2 <= MAX_GRID) {
    return clampGrid(count / 2, 2)
  }
  let best = { cols: count, rows: 1 }
  for (let rows = 1; rows <= Math.min(MAX_GRID, count); rows += 1) {
    if (count % rows !== 0) continue
    const cols = count / rows
    if (cols <= MAX_GRID && cols >= rows) {
      best = { cols, rows }
    }
  }
  return clampGrid(best.cols, best.rows)
}

export function swapMemberPositions(
  positions: Record<number, Point>,
  a: number,
  b: number,
): Record<number, Point> {
  if (a === b) return positions
  const first = positions[a]
  const second = positions[b]
  if (!first || !second) return positions
  return {
    ...positions,
    [a]: { x: second.x, y: second.y },
    [b]: { x: first.x, y: first.y },
  }
}

export function clonePositions(positions: Record<number, Point>): Record<number, Point> {
  const next: Record<number, Point> = {}
  for (const [key, point] of Object.entries(positions)) {
    const n = Number(key)
    if (!Number.isFinite(n) || !point) continue
    next[n] = { x: point.x, y: point.y }
  }
  return next
}

export function stageGrid(stage: StageSize) {
  const stepX = stage.width / STAGE_GRID_X
  const stepY = stage.height / STAGE_GRID_Y
  const xs: number[] = []
  const ys: number[] = []
  for (let i = 1; i < STAGE_GRID_X; i += 1) xs.push(i * stepX)
  for (let i = 1; i < STAGE_GRID_Y; i += 1) ys.push(i * stepY)
  return { stepX, stepY, xs, ys, stroke: STAGE_GRID_STROKE }
}

function gridLineBottoms(stage: StageSize): number[] {
  const { stepY, stroke } = stageGrid(stage)
  const bottoms: number[] = []
  for (let i = 1; i <= STAGE_GRID_Y; i += 1) {
    bottoms.push(i * stepY + stroke / 2)
  }
  return bottoms
}

function snapYToGridLineBottom(y: number, stage: StageSize, radius: number): number {
  const bottoms = gridLineBottoms(stage)
  let best = bottoms[0] - radius
  let bestDist = Infinity
  for (const bottom of bottoms) {
    const snapped = bottom - radius
    const dist = Math.abs(y - snapped)
    if (dist < bestDist) {
      bestDist = dist
      best = snapped
    }
  }
  return best
}

export function snapMemberOnStage(point: Point, stage: StageSize, radius: number): Point {
  const clamped = clampToWorkspace(point, stage, radius)
  const onStage = point.x >= 0 && point.x <= stage.width && point.y >= 0 && point.y <= stage.height
  if (!onStage) return clamped
  return { x: clamped.x, y: snapYToGridLineBottom(clamped.y, stage, radius) }
}

function pickGridRowYs(rowCount: number, stage: StageSize, radius: number): number[] {
  const bottoms = gridLineBottoms(stage)
  if (rowCount <= 0) return []
  if (bottoms.length === 0) {
    return Array.from({ length: rowCount }, () => stage.height / 2)
  }
  if (rowCount === 1) {
    return [bottoms[Math.floor(bottoms.length / 2)] - radius]
  }
  const last = bottoms.length - 1
  const gap = Math.max(1, Math.floor(last / (rowCount - 1)))
  let start = Math.max(0, Math.floor((last - gap * (rowCount - 1)) / 2))
  if (start + gap * (rowCount - 1) > last) {
    start = Math.max(0, last - gap * (rowCount - 1))
  }
  return Array.from({ length: rowCount }, (_, i) => bottoms[Math.min(last, start + i * gap)] - radius)
}

export function defaultPositions(cols: number, rows: number, stage: StageSize): Record<number, Point> {
  const grid = clampGrid(cols, rows)
  const positions: Record<number, Point> = {}
  const pad = Math.min(stage.width, stage.height) * 0.12
  const maxW = Math.max(0, stage.width - pad * 2)
  const spanCols = Math.max(grid.cols - 1, 0)
  const radius = memberRadius(stage)
  const rowYs = pickGridRowYs(grid.rows, stage, radius)
  const spacing = spanCols === 0 ? 0 : maxW / spanCols
  const originX = (stage.width - spanCols * spacing) / 2
  let number = 1

  for (let row = 0; row < grid.rows; row += 1) {
    for (let col = 0; col < grid.cols; col += 1) {
      positions[number] = {
        x: originX + col * spacing,
        y: rowYs[row] ?? stage.height / 2,
      }
      number += 1
    }
  }
  return positions
}

export function defaultPositionsFromCount(count: number, stage: StageSize): Record<number, Point> {
  const grid = inferGrid(count)
  return defaultPositions(grid.cols, grid.rows, stage)
}

export function clampPoint(point: Point, stage: StageSize, pad: number): Point {
  return {
    x: Math.min(stage.width - pad, Math.max(pad, point.x)),
    y: Math.min(stage.height - pad, Math.max(pad, point.y)),
  }
}

export const OFFSTAGE_RATIO = 0.16

export function offstageMargin(stage: StageSize): Point {
  return {
    x: Math.max(96, stage.width * OFFSTAGE_RATIO),
    y: Math.max(96, stage.height * OFFSTAGE_RATIO),
  }
}

export function audienceBand(stage: StageSize) {
  const fontSize = Math.max(22, Math.min(stage.width, stage.height) * 0.028)
  const height = Math.round(fontSize * 1.55)
  const inset = 8
  return {
    x: inset,
    y: inset,
    width: stage.width - inset * 2,
    height,
    fontSize,
    padX: Math.round(Math.max(16, fontSize * 0.55)),
  }
}

export function workspaceRect(stage: StageSize): { x: number; y: number; width: number; height: number } {
  const margin = offstageMargin(stage)
  return {
    x: -margin.x,
    y: -margin.y,
    width: stage.width + margin.x * 2,
    height: stage.height + margin.y * 2,
  }
}

export function clampToWorkspace(point: Point, stage: StageSize, pad: number): Point {
  const margin = offstageMargin(stage)
  return {
    x: Math.min(stage.width + margin.x - pad, Math.max(-margin.x + pad, point.x)),
    y: Math.min(stage.height + margin.y - pad, Math.max(-margin.y + pad, point.y)),
  }
}

export function memberRadius(stage: StageSize): number {
  return Math.min(stage.width, stage.height) * 0.036
}

export function memberFontSize(stage: StageSize, memberCount: number): number {
  const radius = memberRadius(stage)
  if (memberCount >= 100) return radius * 1.02
  if (memberCount >= 10) return radius * 1.18
  return radius * 1.28
}

export function pathDotRadius(radius: number): number {
  return Math.max(8, radius * 0.26)
}

export function extraSlots(from: number, to: number, stage: StageSize): Record<number, Point> {
  const added = to - from
  const positions: Record<number, Point> = {}
  if (added <= 0) return positions
  for (let i = 0; i < added; i += 1) {
    positions[from + 1 + i] = freeMemberPoint(stage, i)
  }
  return positions
}

export function freeMemberPoint(stage: StageSize, extraIndex: number): Point {
  const pad = memberRadius(stage)
  const y = Math.min(stage.height * 0.16, 148)
  const step = Math.min(stage.width, stage.height) * 0.09
  const x = stage.width * 0.12 + extraIndex * step
  return snapMemberOnStage({ x, y }, stage, pad)
}

export function syncPositionsToCount(
  positions: Record<number, Point>,
  fromCount: number,
  toCount: number,
  stage: StageSize,
): Record<number, Point> {
  const next = clonePositions(positions)
  if (toCount > fromCount) {
    Object.assign(next, extraSlots(fromCount, toCount, stage))
  }
  if (toCount < fromCount) {
    for (let n = toCount + 1; n <= fromCount; n += 1) {
      delete next[n]
    }
  }
  return next
}

export function flipPositionsY(
  positions: Record<number, Point>,
  stage: StageSize,
): Record<number, Point> {
  const next: Record<number, Point> = {}
  for (const [key, point] of Object.entries(positions)) {
    next[Number(key)] = { x: point.x, y: stage.height - point.y }
  }
  return next
}

export function scalePositions(
  positions: Record<number, Point>,
  from: StageSize,
  to: StageSize,
): Record<number, Point> {
  const sx = to.width / from.width
  const sy = to.height / from.height
  const next: Record<number, Point> = {}
  for (const [key, point] of Object.entries(positions)) {
    next[Number(key)] = { x: point.x * sx, y: point.y * sy }
  }
  return next
}

export function layoutGridCount(layout: Pick<Layout, 'gridCols' | 'gridRows'>): number {
  const grid = clampGrid(layout.gridCols || MIN_GRID, layout.gridRows || MIN_GRID)
  return grid.cols * grid.rows
}

export function clampExtraCount(gridCount: number, extraCount: number): number {
  const maxExtra = Math.max(0, MAX_MEMBER_COUNT - Math.max(0, gridCount))
  if (!Number.isFinite(extraCount)) return 0
  return Math.min(maxExtra, Math.max(0, Math.round(extraCount)))
}

export function layoutExtraCount(
  layout: Pick<Layout, 'gridCols' | 'gridRows' | 'positions'> & { extraCount?: number },
): number {
  const gridCount = layoutGridCount(layout)
  if (typeof layout.extraCount === 'number' && Number.isFinite(layout.extraCount)) {
    return clampExtraCount(gridCount, layout.extraCount)
  }
  let max = 0
  for (const key of Object.keys(layout.positions ?? {})) {
    const n = Number(key)
    if (Number.isInteger(n) && n > max) max = n
  }
  return clampExtraCount(gridCount, Math.max(0, max - gridCount))
}

export function layoutMemberCount(
  layout: Pick<Layout, 'gridCols' | 'gridRows' | 'positions'> & { extraCount?: number },
  fallbackCount = DEFAULT_MEMBER_COUNT,
): number {
  if (layout.gridCols && layout.gridRows) {
    return layoutGridCount(layout) + layoutExtraCount(layout)
  }
  let max = 0
  for (const key of Object.keys(layout.positions)) {
    const n = Number(key)
    if (Number.isInteger(n) && n > max) max = n
  }
  return max > 0 ? Math.min(MAX_MEMBER_COUNT, max) : fallbackCount
}

export function withGridKeepingExtras(
  layout: Layout,
  cols: number,
  rows: number,
  stage: StageSize,
): Layout {
  const oldGrid = layoutGridCount(layout)
  const extra = layoutExtraCount(layout)
  const grid = clampGrid(cols, rows)
  const newGrid = grid.cols * grid.rows
  const nextExtra = clampExtraCount(newGrid, extra)
  const positions = defaultPositions(grid.cols, grid.rows, stage)
  for (let i = 1; i <= nextExtra; i += 1) {
    positions[newGrid + i] = layout.positions[oldGrid + i] ?? freeMemberPoint(stage, i - 1)
  }
  return {
    ...layout,
    gridCols: grid.cols,
    gridRows: grid.rows,
    extraCount: nextExtra,
    positions,
  }
}

export function addFreeMemberToLayout(layout: Layout, stage: StageSize): Layout {
  const gridCount = layoutGridCount(layout)
  const extra = layoutExtraCount(layout)
  if (gridCount + extra >= MAX_MEMBER_COUNT) return layout
  const nextExtra = extra + 1
  return {
    ...layout,
    extraCount: nextExtra,
    positions: {
      ...clonePositions(layout.positions),
      [gridCount + nextExtra]: freeMemberPoint(stage, extra),
    },
  }
}

export function removeFreeMemberFromLayout(layout: Layout): Layout {
  const extra = layoutExtraCount(layout)
  if (extra <= 0) return layout
  const gridCount = layoutGridCount(layout)
  const positions = clonePositions(layout.positions)
  delete positions[gridCount + extra]
  return {
    ...layout,
    extraCount: extra - 1,
    positions,
  }
}

export function normalizeLayout(
  layout: Layout,
  fallback: { cols: number; rows: number; transitionMs: number; holdMs: number },
): Layout {
  const grid =
    layout.gridCols && layout.gridRows
      ? clampGrid(layout.gridCols, layout.gridRows)
      : clampGrid(fallback.cols, fallback.rows)
  const extraCount = layoutExtraCount({ ...layout, gridCols: grid.cols, gridRows: grid.rows })
  return {
    ...layout,
    gridCols: grid.cols,
    gridRows: grid.rows,
    extraCount,
    transitionMs:
      typeof layout.transitionMs === 'number' && Number.isFinite(layout.transitionMs)
        ? Math.max(0, layout.transitionMs)
        : fallback.transitionMs,
    holdMs:
      typeof layout.holdMs === 'number' && Number.isFinite(layout.holdMs)
        ? Math.max(0, layout.holdMs)
        : fallback.holdMs,
  }
}

export function applyRosterToLayout(
  layout: Layout,
  cols: number,
  rows: number,
  extraCount: number,
  stage: StageSize,
): Layout {
  const grid = clampGrid(cols, rows)
  const extra = clampExtraCount(grid.cols * grid.rows, extraCount)
  let next = layout
  if (layout.gridCols !== grid.cols || layout.gridRows !== grid.rows) {
    next = withGridKeepingExtras(layout, grid.cols, grid.rows, stage)
  }
  let currentExtra = layoutExtraCount(next)
  while (currentExtra < extra) {
    next = addFreeMemberToLayout(next, stage)
    currentExtra += 1
  }
  while (currentExtra > extra) {
    next = removeFreeMemberFromLayout(next)
    currentExtra -= 1
  }
  return {
    ...next,
    gridCols: grid.cols,
    gridRows: grid.rows,
    extraCount: extra,
  }
}

export function uniqueCopyName(base: string, existing: string[]): string {
  const trimmed = base.trim() || '布局'
  const stem = trimmed.replace(/ 副本(?: \d+)?$/, '')
  const names = new Set(existing)
  const first = `${stem} 副本`
  if (!names.has(first)) return first
  let n = 2
  while (names.has(`${stem} 副本 ${n}`)) n += 1
  return `${stem} 副本 ${n}`
}

export function createLayout(
  order: number,
  name: string,
  positions: Record<number, Point>,
  extras: {
    gridCols: number
    gridRows: number
    extraCount?: number
    transitionMs: number
    holdMs: number
  },
): Layout {
  const grid = clampGrid(extras.gridCols, extras.gridRows)
  const extraCount = clampExtraCount(grid.cols * grid.rows, extras.extraCount ?? 0)
  return {
    id: createId(),
    order,
    name,
    gridCols: grid.cols,
    gridRows: grid.rows,
    extraCount,
    transitionMs: Math.max(0, extras.transitionMs),
    holdMs: Math.max(0, extras.holdMs),
    positions: clonePositions(positions),
  }
}

export function reindexLayouts(layouts: Layout[]): Layout[] {
  return layouts.map((layout, index) => ({ ...layout, order: index + 1 }))
}

export function createDefaultRoutine() {
  const stage = { ...DEFAULT_STAGE }
  const grid = clampGrid(DEFAULT_GRID_COLS, DEFAULT_GRID_ROWS)
  const memberCount = grid.cols * grid.rows
  return {
    name: '未命名节目',
    memberCount,
    gridCols: grid.cols,
    gridRows: grid.rows,
    extraCount: 0,
    stage,
    defaultTransitionMs: DEFAULT_TRANSITION_MS,
    holdMs: DEFAULT_HOLD_MS,
    audienceSide: 'top' as const,
    layouts: [
      createLayout(1, '布局 1', defaultPositions(grid.cols, grid.rows, stage), {
        gridCols: grid.cols,
        gridRows: grid.rows,
        transitionMs: DEFAULT_TRANSITION_MS,
        holdMs: DEFAULT_HOLD_MS,
      }),
    ],
  }
}
