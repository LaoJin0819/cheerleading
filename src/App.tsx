import { useEffect, useState } from 'react'
import { ConfirmDialog } from './components/ConfirmDialog'
import { LayoutList } from './components/LayoutList'
import { PlaybackBar } from './components/PlaybackBar'
import { Stage } from './components/Stage'
import { Toolbar } from './components/Toolbar'
import { layoutGridCount } from './lib/positions'
import { readRoutineFile } from './lib/routineIo'
import { useDisplayMemberCount, useDisplayPositions, useRoutineStore } from './store/routineStore'
import type { Routine } from './types'

type Dialog =
  | { type: 'delete'; id: string; name: string }
  | { type: 'import'; routine: Routine; filename: string }
  | { type: 'error'; message: string }
  | null

export default function App() {
  const routine = useRoutineStore((s) => s.routine)
  const selectedLayoutId = useRoutineStore((s) => s.selectedLayoutId)
  const playback = useRoutineStore((s) => s.playback)
  const positions = useDisplayPositions()
  const memberCount = useDisplayMemberCount()
  const moveMember = useRoutineStore((s) => s.moveMember)
  const swapMembers = useRoutineStore((s) => s.swapMembers)
  const deleteLayout = useRoutineStore((s) => s.deleteLayout)
  const importRoutine = useRoutineStore((s) => s.importRoutine)
  const [dialog, setDialog] = useState<Dialog>(null)

  useEffect(() => {
    if (playback.status !== 'playing') return
    let last = performance.now()
    const step = () => {
      const now = performance.now()
      useRoutineStore.getState().advancePlayback(now - last)
      last = now
    }
    const interval = window.setInterval(step, 16)
    return () => window.clearInterval(interval)
  }, [playback.status])

  const current = routine.layouts.find((layout) => layout.id === selectedLayoutId) ?? routine.layouts[0]
  const currentIndex = playback.status === 'idle'
    ? routine.layouts.findIndex((layout) => layout.id === selectedLayoutId)
    : playback.fromIndex
  const nextLayout = routine.layouts[Math.max(0, currentIndex) + 1]
  const layoutLabel = current
    ? `布局 ${String(current.order).padStart(2, '0')}  ${current.name}`
    : '布局'
  const gridCount = layoutGridCount(routine)

  return (
    <div className="app">
      <Toolbar
        onRequestImport={async (file) => {
          try {
            const next = await readRoutineFile(file)
            setDialog({ type: 'import', routine: next, filename: file.name })
          } catch (err) {
            setDialog({
              type: 'error',
              message: err instanceof Error ? err.message : '无法导入该文件',
            })
          }
        }}
      />
      <LayoutList
        onRequestDelete={(id, name) => setDialog({ type: 'delete', id, name })}
      />
      <main className="stage-area">
        <Stage
          stage={routine.stage}
          positions={positions}
          pathTargets={nextLayout?.positions ?? null}
          memberCount={memberCount}
          gridCount={gridCount}
          editable={playback.status === 'idle'}
          layoutLabel={layoutLabel}
          sequenceLabel={(current?.name ?? '').trim() || String(current?.order ?? '')}
          onMove={moveMember}
          onSwap={swapMembers}
        />
      </main>
      <PlaybackBar />

      <ConfirmDialog
        open={dialog?.type === 'delete'}
        title="删除布局"
        message={`确定删除「${dialog?.type === 'delete' ? dialog.name : ''}」吗？此操作不可撤销。`}
        confirmLabel="删除"
        danger
        onCancel={() => setDialog(null)}
        onConfirm={() => {
          if (dialog?.type === 'delete') deleteLayout(dialog.id)
          setDialog(null)
        }}
      />
      <ConfirmDialog
        open={dialog?.type === 'import'}
        title="导入节目"
        message={
          dialog?.type === 'import'
            ? `导入「${dialog.filename}」会覆盖当前节目（当前内容已保存在本机，可用导出 JSON 备份）。`
            : ''
        }
        confirmLabel="导入并覆盖"
        danger
        onCancel={() => setDialog(null)}
        onConfirm={() => {
          if (dialog?.type === 'import') importRoutine(dialog.routine)
          setDialog(null)
        }}
      />
      <ConfirmDialog
        open={dialog?.type === 'error'}
        title="无法导入"
        message={dialog?.type === 'error' ? dialog.message : ''}
        confirmLabel="知道了"
        onCancel={() => setDialog(null)}
        onConfirm={() => setDialog(null)}
      />
    </div>
  )
}
