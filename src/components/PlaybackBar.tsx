import { layoutHoldMs, layoutTransitionMs } from '../lib/interpolate'
import { useRoutineStore } from '../store/routineStore'

export function PlaybackBar() {
  const layouts = useRoutineStore((s) => s.routine.layouts)
  const selectedLayoutId = useRoutineStore((s) => s.selectedLayoutId)
  const playback = useRoutineStore((s) => s.playback)
  const defaultTransitionMs = useRoutineStore((s) => s.routine.defaultTransitionMs)
  const holdMsFallback = useRoutineStore((s) => s.routine.holdMs)
  const play = useRoutineStore((s) => s.play)
  const pause = useRoutineStore((s) => s.pause)
  const stop = useRoutineStore((s) => s.stop)
  const step = useRoutineStore((s) => s.step)

  const idleIndex = layouts.findIndex((layout) => layout.id === selectedLayoutId)
  const safeIndex = playback.status === 'idle'
    ? (idleIndex >= 0 ? idleIndex : 0)
    : playback.fromIndex
  const current = layouts[safeIndex]
  const next = playback.status !== 'idle' && playback.phase === 'move'
    ? layouts[safeIndex + 1]
    : undefined
  const moveDuration = current ? layoutTransitionMs(current, defaultTransitionMs) : defaultTransitionMs
  const holdMs = current ? layoutHoldMs(current, holdMsFallback) : holdMsFallback
  const duration = playback.phase === 'move' ? moveDuration : holdMs
  const progress = duration <= 0 ? 1 : Math.min(1, playback.elapsedMs / duration)
  const playing = playback.status === 'playing'

  return (
    <footer className="playback-bar">
      <div className="playback-buttons">
        <button type="button" onClick={() => step(-1)} disabled={safeIndex <= 0}>
          上一个
        </button>
        {playing ? (
          <button type="button" className="primary" onClick={pause}>
            暂停
          </button>
        ) : (
          <button type="button" className="primary" onClick={play} disabled={layouts.length === 0}>
            {playback.status === 'paused' ? '继续' : '播放变换'}
          </button>
        )}
        <button type="button" onClick={stop} disabled={playback.status === 'idle'}>
          停止
        </button>
        <button type="button" onClick={() => step(1)} disabled={safeIndex >= layouts.length - 1}>
          下一个
        </button>
      </div>
      <div className="playback-status">
        <span data-playback-status>
          布局 {current ? String(current.order).padStart(2, '0') : '--'}
          {next ? ` → ${String(next.order).padStart(2, '0')}` : ''}
          {playback.status !== 'idle' && playback.phase === 'hold' ? ' · 停留' : ''}
          {playback.status !== 'idle' && playback.phase === 'move' ? ' · 变换中' : ''}
        </span>
        <div className="progress" aria-hidden="true">
          <i style={{ width: `${playback.status === 'idle' ? 0 : progress * 100}%` }} />
        </div>
      </div>
    </footer>
  )
}
