export type Point = {
  x: number
  y: number
}

export type StageSize = {
  width: number
  height: number
}

export type Layout = {
  id: string
  order: number
  name: string
  gridCols: number
  gridRows: number
  transitionMs: number
  holdMs: number
  extraCount: number
  positions: Record<number, Point>
}

export type Routine = {
  name: string
  memberCount: number
  gridCols: number
  gridRows: number
  extraCount: number
  stage: StageSize
  defaultTransitionMs: number
  holdMs: number
  audienceSide: 'top'
  layouts: Layout[]
}

export type PlaybackStatus = 'idle' | 'playing' | 'paused'

export type Playback = {
  status: PlaybackStatus
  fromIndex: number
  phase: 'hold' | 'move'
  elapsedMs: number
}

export type RoutineFile = {
  version: 1
  routine: Routine
}
