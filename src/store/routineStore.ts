import { useMemo } from 'react'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { Playback, Point, Routine, StageSize } from '../types'
import { getDisplayMemberCount, getDisplayPositions, layoutHoldMs, layoutTransitionMs } from '../lib/interpolate'
import {
  applyRosterToLayout,
  clampGrid,
  clampStage,
  createDefaultRoutine,
  createLayout,
  flipPositionsY,
  inferGrid,
  layoutExtraCount,
  layoutGridCount,
  normalizeLayout,
  reindexLayouts,
  scalePositions,
  swapMemberPositions,
  uniqueCopyName,
  withGridKeepingExtras,
} from '../lib/positions'

const idlePlayback = (fromIndex = 0): Playback => ({
  status: 'idle',
  fromIndex,
  phase: 'hold',
  elapsedMs: 0,
})

type RoutineState = {
  routine: Routine
  selectedLayoutId: string
  playback: Playback
  setName: (name: string) => void
  setStage: (stage: StageSize) => void
  setGrid: (cols: number, rows: number) => void
  resetLayout: (id: string) => void
  addFreeMember: () => void
  removeFreeMember: () => void
  selectLayout: (id: string) => void
  addLayout: () => void
  renameLayout: (id: string, name: string) => void
  deleteLayout: (id: string) => void
  moveLayout: (id: string, direction: -1 | 1) => void
  setLayoutTransitionMs: (id: string, ms: number) => void
  setLayoutHoldMs: (id: string, ms: number) => void
  moveMember: (member: number, point: Point) => void
  swapMembers: (from: number, to: number) => void
  play: () => void
  pause: () => void
  stop: () => void
  step: (direction: -1 | 1) => void
  advancePlayback: (dt: number) => void
  importRoutine: (routine: Routine) => void
}

function selectedIndex(routine: Routine, selectedLayoutId: string): number {
  const index = routine.layouts.findIndex((layout) => layout.id === selectedLayoutId)
  return index >= 0 ? index : 0
}

function createDebouncedStorage(delayMs = 400) {
  let timer: number | undefined
  return createJSONStorage(() => ({
    getItem: (name: string) => localStorage.getItem(name),
    setItem: (name: string, value: string) => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        localStorage.setItem(name, value)
      }, delayMs)
    },
    removeItem: (name: string) => localStorage.removeItem(name),
  }))
}

export const useRoutineStore = create<RoutineState>()(
  persist(
    (set, get) => {
      const initial = createDefaultRoutine()
      return {
        routine: initial,
        selectedLayoutId: initial.layouts[0].id,
        playback: idlePlayback(0),

        setName: (name) =>
          set((state) => ({
            routine: { ...state.routine, name },
          })),

        setStage: (stage) =>
          set((state) => {
            const next = clampStage(stage.width, stage.height)
            if (next.width === state.routine.stage.width && next.height === state.routine.stage.height) {
              return state
            }
            return {
              routine: {
                ...state.routine,
                stage: next,
                layouts: state.routine.layouts.map((layout) => ({
                  ...layout,
                  positions: scalePositions(layout.positions, state.routine.stage, next),
                })),
              },
            }
          }),

        setGrid: (cols, rows) =>
          set((state) => {
            const grid = clampGrid(cols, rows)
            const extra = layoutExtraCount({
              gridCols: state.routine.gridCols,
              gridRows: state.routine.gridRows,
              extraCount: state.routine.extraCount,
              positions: state.routine.layouts[0]?.positions ?? {},
            })
            if (
              grid.cols === state.routine.gridCols &&
              grid.rows === state.routine.gridRows
            ) {
              return state
            }
            const layouts = state.routine.layouts.map((layout) =>
              applyRosterToLayout(layout, grid.cols, grid.rows, extra, state.routine.stage),
            )
            return {
              routine: {
                ...state.routine,
                gridCols: grid.cols,
                gridRows: grid.rows,
                extraCount: extra,
                memberCount: grid.cols * grid.rows + extra,
                layouts,
              },
            }
          }),

        resetLayout: (id) =>
          set((state) => {
            if (state.playback.status !== 'idle') return state
            let changed = false
            const layouts = state.routine.layouts.map((layout) => {
              if (layout.id !== id) return layout
              changed = true
              return withGridKeepingExtras(
                layout,
                state.routine.gridCols,
                state.routine.gridRows,
                state.routine.stage,
              )
            })
            if (!changed) return state
            return {
              routine: {
                ...state.routine,
                layouts,
              },
            }
          }),

        addFreeMember: () =>
          set((state) => {
            if (state.playback.status !== 'idle') return state
            const extra = (state.routine.extraCount ?? 0) + 1
            const layouts = state.routine.layouts.map((layout) =>
              applyRosterToLayout(
                layout,
                state.routine.gridCols,
                state.routine.gridRows,
                extra,
                state.routine.stage,
              ),
            )
            const extraCount = layouts[0] ? layoutExtraCount(layouts[0]) : 0
            if (extraCount === (state.routine.extraCount ?? 0)) return state
            return {
              routine: {
                ...state.routine,
                extraCount,
                memberCount: layoutGridCount(state.routine) + extraCount,
                layouts,
              },
            }
          }),

        removeFreeMember: () =>
          set((state) => {
            if (state.playback.status !== 'idle') return state
            const currentExtra = state.routine.extraCount ?? 0
            if (currentExtra <= 0) return state
            const layouts = state.routine.layouts.map((layout) =>
              applyRosterToLayout(
                layout,
                state.routine.gridCols,
                state.routine.gridRows,
                currentExtra - 1,
                state.routine.stage,
              ),
            )
            const extraCount = layouts[0] ? layoutExtraCount(layouts[0]) : 0
            return {
              routine: {
                ...state.routine,
                extraCount,
                memberCount: layoutGridCount(state.routine) + extraCount,
                layouts,
              },
            }
          }),

        selectLayout: (id) =>
          set((state) => {
            const index = selectedIndex(state.routine, id)
            return {
              selectedLayoutId: state.routine.layouts[index]?.id ?? id,
              playback: idlePlayback(index),
            }
          }),

        addLayout: () =>
          set((state) => {
            const index = selectedIndex(state.routine, state.selectedLayoutId)
            const source = state.routine.layouts[index] ?? state.routine.layouts[state.routine.layouts.length - 1]
            if (!source) return state
            const inserted = createLayout(
              index + 2,
              uniqueCopyName(
                source.name,
                state.routine.layouts.map((layout) => layout.name),
              ),
              source.positions,
              {
                gridCols: state.routine.gridCols,
                gridRows: state.routine.gridRows,
                extraCount: state.routine.extraCount ?? layoutExtraCount(source),
                transitionMs: source.transitionMs ?? state.routine.defaultTransitionMs,
                holdMs: source.holdMs ?? state.routine.holdMs,
              },
            )
            const layouts = [
              ...state.routine.layouts.slice(0, index + 1),
              inserted,
              ...state.routine.layouts.slice(index + 1),
            ]
            return {
              routine: { ...state.routine, layouts: reindexLayouts(layouts) },
              selectedLayoutId: inserted.id,
              playback: idlePlayback(index + 1),
            }
          }),

        renameLayout: (id, name) =>
          set((state) => ({
            routine: {
              ...state.routine,
              layouts: state.routine.layouts.map((layout) =>
                layout.id === id ? { ...layout, name } : layout,
              ),
            },
          })),

        deleteLayout: (id) =>
          set((state) => {
            if (state.routine.layouts.length <= 1) return state
            const index = state.routine.layouts.findIndex((layout) => layout.id === id)
            if (index < 0) return state
            const layouts = state.routine.layouts.filter((layout) => layout.id !== id)
            const nextIndex = Math.min(index, layouts.length - 1)
            return {
              routine: { ...state.routine, layouts: reindexLayouts(layouts) },
              selectedLayoutId: layouts[nextIndex].id,
              playback: idlePlayback(nextIndex),
            }
          }),

        moveLayout: (id, direction) =>
          set((state) => {
            const index = state.routine.layouts.findIndex((layout) => layout.id === id)
            const nextIndex = index + direction
            if (index < 0 || nextIndex < 0 || nextIndex >= state.routine.layouts.length) return state
            const layouts = [...state.routine.layouts]
            const [item] = layouts.splice(index, 1)
            layouts.splice(nextIndex, 0, item)
            return {
              routine: { ...state.routine, layouts: reindexLayouts(layouts) },
              selectedLayoutId: id,
              playback: idlePlayback(nextIndex),
            }
          }),

        setLayoutTransitionMs: (id, ms) =>
          set((state) => ({
            routine: {
              ...state.routine,
              layouts: state.routine.layouts.map((layout) =>
                layout.id === id ? { ...layout, transitionMs: Math.max(0, ms) } : layout,
              ),
            },
          })),

        setLayoutHoldMs: (id, ms) =>
          set((state) => ({
            routine: {
              ...state.routine,
              layouts: state.routine.layouts.map((layout) =>
                layout.id === id ? { ...layout, holdMs: Math.max(0, ms) } : layout,
              ),
            },
          })),

        moveMember: (member, point) =>
          set((state) => {
            if (state.playback.status !== 'idle') return state
            return {
              routine: {
                ...state.routine,
                layouts: state.routine.layouts.map((layout) =>
                  layout.id === state.selectedLayoutId
                    ? { ...layout, positions: { ...layout.positions, [member]: point } }
                    : layout,
                ),
              },
            }
          }),

        swapMembers: (from, to) =>
          set((state) => {
            if (state.playback.status !== 'idle') return state
            if (from === to) return state
            return {
              routine: {
                ...state.routine,
                layouts: state.routine.layouts.map((layout) =>
                  layout.id === state.selectedLayoutId
                    ? { ...layout, positions: swapMemberPositions(layout.positions, from, to) }
                    : layout,
                ),
              },
            }
          }),

        play: () =>
          set((state) => {
            if (state.routine.layouts.length === 0) return state
            if (state.playback.status === 'paused') {
              return { playback: { ...state.playback, status: 'playing' } }
            }
            let index = selectedIndex(state.routine, state.selectedLayoutId)
            if (index >= state.routine.layouts.length - 1 && state.routine.layouts.length > 1) {
              index = 0
            }
            return {
              playback: {
                status: 'playing',
                fromIndex: index,
                phase: 'hold',
                elapsedMs: 0,
              },
            }
          }),

        pause: () =>
          set((state) =>
            state.playback.status === 'playing'
              ? { playback: { ...state.playback, status: 'paused' } }
              : state,
          ),

        stop: () =>
          set((state) => {
            const index = state.playback.status === 'idle'
              ? selectedIndex(state.routine, state.selectedLayoutId)
              : state.playback.fromIndex
            const layout = state.routine.layouts[index]
            return {
              selectedLayoutId: layout?.id ?? state.selectedLayoutId,
              playback: idlePlayback(index),
            }
          }),

        step: (direction) =>
          set((state) => {
            const current = state.playback.status === 'idle'
              ? selectedIndex(state.routine, state.selectedLayoutId)
              : state.playback.fromIndex
            const next = Math.min(state.routine.layouts.length - 1, Math.max(0, current + direction))
            const layout = state.routine.layouts[next]
            if (!layout) return state
            return {
              selectedLayoutId: layout.id,
              playback: idlePlayback(next),
            }
          }),

        advancePlayback: (dt) => {
          const { playback, routine } = get()
          if (playback.status !== 'playing') return
          const { layouts, holdMs, defaultTransitionMs } = routine
          if (layouts.length === 0) return

          let { fromIndex, phase, elapsedMs } = playback
          elapsedMs += Math.max(0, dt)
          const currentHoldMs = layoutHoldMs(layouts[fromIndex], holdMs)

          if (phase === 'hold') {
            if (fromIndex >= layouts.length - 1) {
              if (elapsedMs >= currentHoldMs) {
                set({
                  selectedLayoutId: layouts[fromIndex].id,
                  playback: idlePlayback(fromIndex),
                })
                return
              }
            } else if (elapsedMs >= currentHoldMs) {
              phase = 'move'
              elapsedMs = 0
            }
          } else {
            const duration = layoutTransitionMs(layouts[fromIndex], defaultTransitionMs)
            if (elapsedMs >= duration) {
              fromIndex = Math.min(fromIndex + 1, layouts.length - 1)
              phase = 'hold'
              elapsedMs = 0
              set({
                selectedLayoutId: layouts[fromIndex].id,
                playback: { status: 'playing', fromIndex, phase, elapsedMs },
              })
              return
            }
          }

          set({
            playback: { status: 'playing', fromIndex, phase, elapsedMs },
          })
        },

        importRoutine: (routine) =>
          set({
            routine,
            selectedLayoutId: routine.layouts[0].id,
            playback: idlePlayback(0),
          }),
      }
    },
    {
      name: 'lalateam-routine-v1',
      storage: createDebouncedStorage(),
      partialize: (state) => ({
        routine: state.routine,
        selectedLayoutId: state.selectedLayoutId,
      }),
      merge: (persisted, current) => {
        const saved = persisted as Partial<Pick<RoutineState, 'routine' | 'selectedLayoutId'>> | undefined
        if (!saved?.routine?.layouts?.length) return current
        const savedRoutine = saved.routine
        const selectedLayoutId = savedRoutine.layouts.some((layout) => layout.id === saved.selectedLayoutId)
          ? saved.selectedLayoutId!
          : savedRoutine.layouts[0].id
        const grid =
          savedRoutine.gridCols && savedRoutine.gridRows
            ? clampGrid(savedRoutine.gridCols, savedRoutine.gridRows)
            : inferGrid(savedRoutine.memberCount)
        const fallback = {
          cols: grid.cols,
          rows: grid.rows,
          transitionMs: savedRoutine.defaultTransitionMs ?? 1500,
          holdMs: savedRoutine.holdMs ?? 400,
        }
        const needsFlip = savedRoutine.audienceSide !== 'top'
        const layouts = savedRoutine.layouts.map((layout) => {
          const normalized = normalizeLayout(layout, fallback)
          return needsFlip
            ? { ...normalized, positions: flipPositionsY(normalized.positions, savedRoutine.stage) }
            : normalized
        })
        const roster = clampGrid(layouts[0].gridCols, layouts[0].gridRows)
        const extraCount = Math.max(
          typeof savedRoutine.extraCount === 'number' ? savedRoutine.extraCount : 0,
          ...layouts.map((layout) => layoutExtraCount(layout)),
        )
        const synced = layouts.map((layout) =>
          applyRosterToLayout(layout, roster.cols, roster.rows, extraCount, savedRoutine.stage),
        )
        const routine = {
          ...savedRoutine,
          stage: clampStage(savedRoutine.stage.width, savedRoutine.stage.height),
          gridCols: roster.cols,
          gridRows: roster.rows,
          extraCount,
          memberCount: roster.cols * roster.rows + extraCount,
          audienceSide: 'top' as const,
          layouts: synced,
        }
        if (needsFlip) {
          try {
            localStorage.setItem(
              'lalateam-routine-v1',
              JSON.stringify({
                state: { routine, selectedLayoutId },
                version: 0,
              }),
            )
          } catch {
            // ignore quota errors during one-time orientation migration
          }
        }
        return {
          ...current,
          routine,
          selectedLayoutId,
          playback: idlePlayback(selectedIndex(saved.routine, selectedLayoutId)),
        }
      },
    },
  ),
)

export function useDisplayPositions() {
  const routine = useRoutineStore((state) => state.routine)
  const selectedLayoutId = useRoutineStore((state) => state.selectedLayoutId)
  const playback = useRoutineStore((state) => state.playback)
  return useMemo(
    () => getDisplayPositions(routine, selectedLayoutId, playback),
    [playback, routine, selectedLayoutId],
  )
}

export function useDisplayMemberCount() {
  const routine = useRoutineStore((state) => state.routine)
  const selectedLayoutId = useRoutineStore((state) => state.selectedLayoutId)
  const playback = useRoutineStore((state) => state.playback)
  return useMemo(
    () => getDisplayMemberCount(routine, selectedLayoutId, playback),
    [playback, routine, selectedLayoutId],
  )
}
