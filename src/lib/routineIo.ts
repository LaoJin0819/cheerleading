import type { Layout, Point, Routine, RoutineFile, StageSize } from '../types'
import {
  applyRosterToLayout,
  createDefaultRoutine,
  defaultPositions,
  inferGrid,
  clampGrid,
  clampStage,
  clampExtraCount,
  flipPositionsY,
  freeMemberPoint,
  layoutExtraCount,
  reindexLayouts,
} from './positions'

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function parsePoint(value: unknown): Point | null {
  if (!value || typeof value !== 'object') return null
  const point = value as { x?: unknown; y?: unknown }
  if (typeof point.x !== 'number' || typeof point.y !== 'number') return null
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null
  return { x: point.x, y: point.y }
}

function parsePositions(
  raw: unknown,
  memberCount: number,
  stage: StageSize,
  grid: { cols: number; rows: number },
): Record<number, Point> {
  const next: Record<number, Point> = {}
  if (raw && typeof raw === 'object') {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      const n = Number(key)
      const point = parsePoint(value)
      if (!Number.isInteger(n) || n < 1 || n > memberCount || !point) continue
      next[n] = point
    }
  }
  const gridCount = grid.cols * grid.rows
  const gridFallback = defaultPositions(grid.cols, grid.rows, stage)
  for (let i = 1; i <= memberCount; i += 1) {
    if (!next[i]) {
      next[i] =
        i <= gridCount
          ? (gridFallback[i] ?? { x: stage.width / 2, y: stage.height / 2 })
          : freeMemberPoint(stage, i - gridCount - 1)
    }
  }
  return next
}

function parseLayout(
  raw: unknown,
  index: number,
  fallback: { cols: number; rows: number; transitionMs: number; holdMs: number },
  stage: StageSize,
): Layout | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Partial<Layout>
  const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : `布局 ${index + 1}`
  const grid =
    item.gridCols && item.gridRows
      ? clampGrid(asNumber(item.gridCols, fallback.cols), asNumber(item.gridRows, fallback.rows))
      : clampGrid(fallback.cols, fallback.rows)
  const gridCount = grid.cols * grid.rows
  let extraCount = 0
  if (typeof item.extraCount === 'number' && Number.isFinite(item.extraCount)) {
    extraCount = item.extraCount
  } else if (item.positions && typeof item.positions === 'object') {
    let max = 0
    for (const key of Object.keys(item.positions as Record<string, unknown>)) {
      const n = Number(key)
      if (Number.isInteger(n) && n > max) max = n
    }
    extraCount = Math.max(0, max - gridCount)
  }
  extraCount = clampExtraCount(gridCount, extraCount)
  const memberCount = gridCount + extraCount
  return {
    id: typeof item.id === 'string' && item.id ? item.id : `imported-${index}-${Date.now()}`,
    order: index + 1,
    name,
    gridCols: grid.cols,
    gridRows: grid.rows,
    extraCount,
    transitionMs: Math.max(0, asNumber(item.transitionMs, fallback.transitionMs)),
    holdMs: Math.max(0, asNumber(item.holdMs, fallback.holdMs)),
    positions: parsePositions(item.positions, memberCount, stage, grid),
  }
}

export function parseRoutine(data: unknown): Routine {
  let source: unknown = data
  if (data && typeof data === 'object' && 'routine' in data) {
    source = (data as RoutineFile).routine
  }
  if (!source || typeof source !== 'object') {
    throw new Error('文件内容不是有效的节目数据')
  }
  const raw = source as Partial<Routine>
  const fallback = createDefaultRoutine()
  const grid =
    raw.gridCols && raw.gridRows
      ? clampGrid(asNumber(raw.gridCols, fallback.gridCols), asNumber(raw.gridRows, fallback.gridRows))
      : inferGrid(asNumber(raw.memberCount, fallback.memberCount))
  const defaultTransitionMs = Math.max(0, asNumber(raw.defaultTransitionMs, fallback.defaultTransitionMs))
  const holdMs = Math.max(0, asNumber(raw.holdMs, fallback.holdMs))
  const stage = clampStage(
    asNumber(raw.stage?.width, fallback.stage.width),
    asNumber(raw.stage?.height, fallback.stage.height),
  )
  const layoutsSource = Array.isArray(raw.layouts) ? raw.layouts : []
  const layouts = layoutsSource
    .map((item, index) =>
      parseLayout(
        item,
        index,
        { cols: grid.cols, rows: grid.rows, transitionMs: defaultTransitionMs, holdMs },
        stage,
      ),
    )
    .filter((item): item is Layout => item !== null)

  if (layouts.length === 0) {
    throw new Error('节目里没有可用布局')
  }

  const ids = new Set<string>()
  for (const layout of layouts) {
    if (ids.has(layout.id)) {
      layout.id = `${layout.id}-${Math.random().toString(36).slice(2, 7)}`
    }
    ids.add(layout.id)
  }

  const extraCount = Math.max(
    clampExtraCount(grid.cols * grid.rows, asNumber(raw.extraCount, 0)),
    ...layouts.map((layout) => layoutExtraCount(layout)),
  )
  const oriented = reindexLayouts(
    raw.audienceSide === 'top'
      ? layouts
      : layouts.map((layout) => ({
          ...layout,
          positions: flipPositionsY(layout.positions, stage),
        })),
  )
  const synced = oriented.map((layout) => applyRosterToLayout(layout, grid.cols, grid.rows, extraCount, stage))

  return {
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : '未命名节目',
    memberCount: grid.cols * grid.rows + extraCount,
    gridCols: grid.cols,
    gridRows: grid.rows,
    extraCount,
    stage,
    defaultTransitionMs,
    holdMs,
    audienceSide: 'top',
    layouts: synced,
  }
}

export function toRoutineFile(routine: Routine): RoutineFile {
  return { version: 1, routine }
}

export function safeFilename(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]+/g, '_').trim()
  return cleaned || '拉拉队节目'
}

export async function readRoutineFile(file: File): Promise<Routine> {
  const text = await file.text()
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('无法解析 JSON 文件')
  }
  return parseRoutine(data)
}
