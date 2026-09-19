import { useState } from 'react'
import { useRoutineStore } from '../store/routineStore'
import type { Layout } from '../types'
import { ConfirmDialog } from './ConfirmDialog'

type LayoutListProps = {
  onRequestDelete: (id: string, name: string) => void
}

export function LayoutList({ onRequestDelete }: LayoutListProps) {
  const layouts = useRoutineStore((s) => s.routine.layouts)
  const gridCols = useRoutineStore((s) => s.routine.gridCols)
  const gridRows = useRoutineStore((s) => s.routine.gridRows)
  const selectedLayoutId = useRoutineStore((s) => s.selectedLayoutId)
  const playbackStatus = useRoutineStore((s) => s.playback.status)
  const selectLayout = useRoutineStore((s) => s.selectLayout)
  const addLayout = useRoutineStore((s) => s.addLayout)
  const renameLayout = useRoutineStore((s) => s.renameLayout)
  const moveLayout = useRoutineStore((s) => s.moveLayout)
  const resetLayout = useRoutineStore((s) => s.resetLayout)
  const [pendingReset, setPendingReset] = useState<{ id: string; name: string } | null>(null)

  return (
    <aside className="layout-list">
      <div className="layout-list-header">
        <h2>布局顺序</h2>
        <button
          type="button"
          className="primary"
          title="按当前选中的布局复制一份，便于微调"
          onClick={addLayout}
        >
          新建布局
        </button>
      </div>
      <div className="layout-list-scroll">
        {layouts.map((layout, index) => {
          const selected = layout.id === selectedLayoutId
          const isLast = index === layouts.length - 1
          return (
            <article
              key={layout.id}
              className={selected ? 'layout-card is-selected' : 'layout-card'}
              onClick={() => selectLayout(layout.id)}
            >
              <div className="layout-card-top">
                <span className="layout-order">{String(layout.order).padStart(2, '0')}</span>
                <div className="layout-actions">
                  <button
                    type="button"
                    className="icon-btn"
                    disabled={index === 0}
                    onClick={(event) => {
                      event.stopPropagation()
                      moveLayout(layout.id, -1)
                    }}
                  >
                    上移
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    disabled={isLast}
                    onClick={(event) => {
                      event.stopPropagation()
                      moveLayout(layout.id, 1)
                    }}
                  >
                    下移
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    disabled={playbackStatus !== 'idle'}
                    onClick={(event) => {
                      event.stopPropagation()
                      setPendingReset({ id: layout.id, name: layout.name })
                    }}
                  >
                    重置
                  </button>
                  <button
                    type="button"
                    className="icon-btn danger"
                    disabled={layouts.length <= 1}
                    onClick={(event) => {
                      event.stopPropagation()
                      onRequestDelete(layout.id, layout.name)
                    }}
                  >
                    删除
                  </button>
                </div>
              </div>
              <input
                className="layout-name"
                value={layout.name}
                aria-label={`布局 ${layout.order} 名称`}
                onChange={(event) => renameLayout(layout.id, event.target.value)}
                onClick={(event) => event.stopPropagation()}
              />
              <LayoutTiming layout={layout} />
            </article>
          )
        })}
      </div>
      <ConfirmDialog
        open={pendingReset !== null}
        title="重置站位"
        message={
          pendingReset !== null
            ? `「${pendingReset.name}」将按 ${gridCols}×${gridRows} 重排网格站位。已拖动的网格位置会丢失，自由人会保留。`
            : ''
        }
        confirmLabel="重置"
        danger
        onCancel={() => setPendingReset(null)}
        onConfirm={() => {
          if (pendingReset !== null) {
            resetLayout(pendingReset.id)
            selectLayout(pendingReset.id)
          }
          setPendingReset(null)
        }}
      />
    </aside>
  )
}

function secondsValue(ms: number): string {
  return String(Math.round(ms / 100) / 10)
}

function LayoutTiming({ layout }: { layout: Layout }) {
  const setLayoutTransitionMs = useRoutineStore((s) => s.setLayoutTransitionMs)
  const setLayoutHoldMs = useRoutineStore((s) => s.setLayoutHoldMs)

  return (
    <div className="layout-settings" onClick={(event) => event.stopPropagation()}>
      <label>
        变换
        <span className="with-unit">
          <input
            className="time-input"
            type="number"
            min={0}
            step={0.1}
            inputMode="decimal"
            aria-label={`布局 ${layout.order} 变换秒`}
            value={secondsValue(layout.transitionMs)}
            onChange={(event) => {
              const value = Number(event.target.value)
              if (!Number.isFinite(value)) return
              setLayoutTransitionMs(layout.id, Math.round(value * 1000))
            }}
          />
          秒
        </span>
      </label>
      <label>
        停留
        <span className="with-unit">
          <input
            className="time-input"
            type="number"
            min={0}
            step={0.1}
            inputMode="decimal"
            aria-label={`布局 ${layout.order} 停留秒`}
            value={secondsValue(layout.holdMs)}
            onChange={(event) => {
              const value = Number(event.target.value)
              if (!Number.isFinite(value)) return
              setLayoutHoldMs(layout.id, Math.round(value * 1000))
            }}
          />
          秒
        </span>
      </label>
    </div>
  )
}
