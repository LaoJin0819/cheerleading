import { useEffect, useRef, useState } from 'react'
import { ConfirmDialog } from './ConfirmDialog'
import { exportAllLayoutsZip, exportLayoutPng, exportRoutineJson } from '../lib/exportPng'
import { exportRoutineVideo } from '../lib/exportVideo'
import {
  layoutGridCount,
  MAX_GRID,
  MAX_MEMBER_COUNT,
  MAX_STAGE,
  MIN_GRID,
  MIN_STAGE,
} from '../lib/positions'
import { useRoutineStore } from '../store/routineStore'

const STAGE_PRESETS = [
  { label: '16:9', width: 1600, height: 900 },
  { label: '4:3', width: 1200, height: 900 },
  { label: '场地', width: 1600, height: 800 },
]

type ToolbarProps = {
  onRequestImport: (file: File) => void
}

function presetValue(width: number, height: number): string {
  const preset = STAGE_PRESETS.find((item) => item.width === width && item.height === height)
  return preset ? `${preset.width}x${preset.height}` : 'custom'
}

export function Toolbar({ onRequestImport }: ToolbarProps) {
  const routine = useRoutineStore((s) => s.routine)
  const selectedLayoutId = useRoutineStore((s) => s.selectedLayoutId)
  const playbackStatus = useRoutineStore((s) => s.playback.status)
  const setName = useRoutineStore((s) => s.setName)
  const setStage = useRoutineStore((s) => s.setStage)
  const setGrid = useRoutineStore((s) => s.setGrid)
  const addFreeMember = useRoutineStore((s) => s.addFreeMember)
  const removeFreeMember = useRoutineStore((s) => s.removeFreeMember)
  const fileRef = useRef<HTMLInputElement>(null)
  const [widthDraft, setWidthDraft] = useState(String(routine.stage.width))
  const [heightDraft, setHeightDraft] = useState(String(routine.stage.height))
  const [colsDraft, setColsDraft] = useState(String(routine.gridCols))
  const [rowsDraft, setRowsDraft] = useState(String(routine.gridRows))
  const [pendingGrid, setPendingGrid] = useState<{ cols: number; rows: number; count: number } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [videoProgress, setVideoProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const currentLayout = routine.layouts.find((layout) => layout.id === selectedLayoutId) ?? routine.layouts[0]
  const gridCount = layoutGridCount(routine)
  const extraCount = routine.extraCount ?? 0
  const memberTotal = gridCount + extraCount
  const idle = playbackStatus === 'idle'

  useEffect(() => {
    setWidthDraft(String(routine.stage.width))
    setHeightDraft(String(routine.stage.height))
  }, [routine.stage.height, routine.stage.width])

  useEffect(() => {
    setColsDraft(String(routine.gridCols))
    setRowsDraft(String(routine.gridRows))
  }, [routine.gridCols, routine.gridRows])

  const applyStage = (nextWidth = Number(widthDraft), nextHeight = Number(heightDraft)) => {
    if (!Number.isFinite(nextWidth) || !Number.isFinite(nextHeight)) {
      setWidthDraft(String(routine.stage.width))
      setHeightDraft(String(routine.stage.height))
      return
    }
    const width = Math.min(MAX_STAGE, Math.max(MIN_STAGE, Math.round(nextWidth)))
    const height = Math.min(MAX_STAGE, Math.max(MIN_STAGE, Math.round(nextHeight)))
    setWidthDraft(String(width))
    setHeightDraft(String(height))
    setStage({ width, height })
  }

  const applyGrid = (nextCols = Number(colsDraft), nextRows = Number(rowsDraft)) => {
    if (!Number.isFinite(nextCols) || !Number.isFinite(nextRows)) {
      setColsDraft(String(routine.gridCols))
      setRowsDraft(String(routine.gridRows))
      return
    }
    const cols = Math.min(MAX_GRID, Math.max(MIN_GRID, Math.round(nextCols)))
    const rows = Math.min(MAX_GRID, Math.max(MIN_GRID, Math.round(nextRows)))
    const nextCount = cols * rows
    if (cols === routine.gridCols && rows === routine.gridRows) {
      setColsDraft(String(cols))
      setRowsDraft(String(rows))
      return
    }
    if (nextCount < gridCount) {
      setPendingGrid({ cols, rows, count: nextCount })
      return
    }
    setColsDraft(String(cols))
    setRowsDraft(String(rows))
    setGrid(cols, rows)
  }

  const runExport = async (task: () => Promise<void>, label: string) => {
    setError(null)
    setBusy(label)
    try {
      await task()
    } catch (err) {
      setError(err instanceof Error ? err.message : '导出失败')
    } finally {
      setBusy(null)
    }
  }

  return (
    <header className="toolbar">
      <div className="brand">
        <strong>拉拉队队形</strong>
        <input
          className="routine-name"
          value={routine.name}
          onChange={(event) => setName(event.target.value)}
          aria-label="节目名称"
        />
      </div>

      <div className="canvas-size">
        <span className="canvas-size-label">画布</span>
        <label className="field">
          长
          <input
            className="stage-input"
            type="number"
            min={MIN_STAGE}
            max={MAX_STAGE}
            value={widthDraft}
            aria-label="画布长，最大宽度"
            onChange={(event) => setWidthDraft(event.target.value)}
            onBlur={() => applyStage()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') applyStage()
            }}
          />
        </label>
        <span className="grid-times" aria-hidden="true">
          ×
        </span>
        <label className="field">
          宽
          <input
            className="stage-input"
            type="number"
            min={MIN_STAGE}
            max={MAX_STAGE}
            value={heightDraft}
            aria-label="画布宽，最大高度"
            onChange={(event) => setHeightDraft(event.target.value)}
            onBlur={() => applyStage()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') applyStage()
            }}
          />
        </label>
        <label className="field">
          比例
          <select
            value={presetValue(routine.stage.width, routine.stage.height)}
            aria-label="画布比例预设"
            onChange={(event) => {
              const preset = STAGE_PRESETS.find((item) => `${item.width}x${item.height}` === event.target.value)
              if (preset) setStage({ width: preset.width, height: preset.height })
            }}
          >
            {presetValue(routine.stage.width, routine.stage.height) === 'custom' && (
              <option value="custom">自定义</option>
            )}
            {STAGE_PRESETS.map((preset) => (
              <option key={preset.label} value={`${preset.width}x${preset.height}`}>
                {preset.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="people-size">
        <span className="canvas-size-label">人数</span>
        <label className="field">
          长
          <input
            className="grid-input"
            type="number"
            min={MIN_GRID}
            max={MAX_GRID}
            value={colsDraft}
            aria-label="人数长，横向人数"
            disabled={!idle}
            onChange={(event) => setColsDraft(event.target.value)}
            onBlur={() => applyGrid()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') applyGrid()
            }}
          />
        </label>
        <span className="grid-times" aria-hidden="true">
          ×
        </span>
        <label className="field">
          宽
          <input
            className="grid-input"
            type="number"
            min={MIN_GRID}
            max={MAX_GRID}
            value={rowsDraft}
            aria-label="人数宽，排数"
            disabled={!idle}
            onChange={(event) => setRowsDraft(event.target.value)}
            onBlur={() => applyGrid()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') applyGrid()
            }}
          />
        </label>
        <span className="member-total">{memberTotal}人</span>
        <div className="free-member-field">
          自由人
          <button
            type="button"
            className="icon-btn"
            disabled={!idle || memberTotal >= MAX_MEMBER_COUNT}
            aria-label="增加自由人"
            onClick={() => addFreeMember()}
          >
            +
          </button>
          <span>{extraCount}</span>
          <button
            type="button"
            className="icon-btn"
            disabled={!idle || extraCount <= 0}
            aria-label="减少自由人"
            onClick={() => removeFreeMember()}
          >
            −
          </button>
        </div>
      </div>

      <div className="toolbar-actions">
        <button
          type="button"
          disabled={!currentLayout || busy !== null}
          onClick={() => currentLayout && runExport(() => exportLayoutPng(routine, currentLayout), 'current')}
        >
          {busy === 'current' ? '导出中…' : '导出当前图'}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => runExport(() => exportAllLayoutsZip(routine), 'all')}
        >
          {busy === 'all' ? '导出中…' : '导出全部图'}
        </button>
        <button
          type="button"
          disabled={busy !== null || routine.layouts.length === 0}
          onClick={() =>
            runExport(async () => {
              setVideoProgress(0)
              await exportRoutineVideo(routine, setVideoProgress)
            }, 'video')
          }
        >
          {busy === 'video' ? `导出中 ${Math.round(videoProgress * 100)}%` : '导出变换视频'}
        </button>
        <button type="button" onClick={() => exportRoutineJson(routine)}>
          导出 JSON
        </button>
        <button type="button" onClick={() => fileRef.current?.click()}>
          导入 JSON
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) onRequestImport(file)
          }}
        />
      </div>
      {error && <p className="toolbar-error">{error}</p>}
      <ConfirmDialog
        open={pendingGrid !== null}
        title="减少人数"
        message={
          pendingGrid !== null
            ? `所有布局的网格将改为 ${pendingGrid.cols}×${pendingGrid.rows}（${pendingGrid.count}人）。编号 ${pendingGrid.count + 1}–${gridCount} 的网格队员会从每个布局移除。${extraCount > 0 ? `${extraCount} 名自由人会保留并顺延编号。` : ''}`
            : ''
        }
        confirmLabel="确认减少"
        danger
        onCancel={() => {
          setPendingGrid(null)
          setColsDraft(String(routine.gridCols))
          setRowsDraft(String(routine.gridRows))
        }}
        onConfirm={() => {
          if (pendingGrid !== null) setGrid(pendingGrid.cols, pendingGrid.rows)
          setPendingGrid(null)
        }}
      />
    </header>
  )
}
