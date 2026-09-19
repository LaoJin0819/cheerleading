import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Point, StageSize } from '../types'
import { audienceBand, memberFontSize, memberRadius, pathDotRadius, snapMemberOnStage, stageGrid, workspaceRect } from '../lib/positions'
import { collectMovePaths, lineEndBeforeDot } from '../lib/interpolate'
import {
  clampCamera,
  clientToStage,
  defaultCamera,
  DEFAULT_CAMERA,
  distance,
  screenScale,
  stageToClient,
  viewBox,
  zoomAt,
  type Camera,
} from '../lib/svgCoords'

type StageProps = {
  stage: StageSize
  positions: Record<number, Point>
  pathTargets?: Record<number, Point> | null
  memberCount: number
  gridCount: number
  editable: boolean
  layoutLabel: string
  sequenceLabel: string
  onMove: (member: number, point: Point) => void
  onSwap: (from: number, to: number) => void
}

const DRAG_THRESHOLD = 8

type PointerMode = 'none' | 'member' | 'pan' | 'pinch'

function axisLockedPoint(origin: Point, next: Point): Point {
  const dx = Math.abs(next.x - origin.x)
  const dy = Math.abs(next.y - origin.y)
  if (dx >= dy) return { x: next.x, y: origin.y }
  return { x: origin.x, y: next.y }
}

function hitMember(
  point: Point,
  positions: Record<number, Point>,
  memberCount: number,
  hitR: number,
): number | null {
  let best: { n: number; d: number } | null = null
  for (let n = memberCount; n >= 1; n -= 1) {
    const pos = positions[n]
    if (!pos) continue
    const d = distance(point, pos)
    if (d <= hitR && (!best || d < best.d)) {
      best = { n, d }
    }
  }
  return best?.n ?? null
}

export function Stage({
  stage,
  positions,
  pathTargets = null,
  memberCount,
  gridCount,
  editable,
  layoutLabel,
  sequenceLabel,
  onMove,
  onSwap,
}: StageProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [camera, setCamera] = useState<Camera>(() => defaultCamera(stage))
  const [dragging, setDragging] = useState<number | null>(null)
  const [editing, setEditing] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const [editorPos, setEditorPos] = useState({ left: 0, top: 0, size: 44 })
  const draggingRef = useRef<number | null>(null)
  const didDragRef = useRef(false)
  const pointers = useRef(new Map<number, Point>())
  const mode = useRef<PointerMode>('none')
  const dragOffset = useRef<Point>({ x: 0, y: 0 })
  const dragStartClient = useRef<Point>({ x: 0, y: 0 })
  const dragOrigin = useRef<Point>({ x: 0, y: 0 })
  const pinchStart = useRef({ distance: 0, camera: DEFAULT_CAMERA })
  const panStart = useRef({ point: { x: 0, y: 0 }, camera: DEFAULT_CAMERA })

  const radius = memberRadius(stage)
  const workspace = workspaceRect(stage)
  const audience = audienceBand(stage)

  const hitRadius = useMemo(() => {
    const svg = svgRef.current
    if (!svg) return radius * 1.45
    const rect = svg.getBoundingClientRect()
    const vbW = workspace.width / camera.zoom
    const pxPerUnit = Math.min(rect.width / vbW, rect.height / (workspace.height / camera.zoom))
    const minR = pxPerUnit > 0 ? 22 / pxPerUnit : radius
    return Math.max(radius * 1.35, minR)
  }, [camera.zoom, radius, workspace.height, workspace.width])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const svg = svgRef.current
      if (!svg) return
      const factor = event.deltaY > 0 ? 0.92 : 1.08
      setCamera((current) => zoomAt(current, stage, svg, event.clientX, event.clientY, current.zoom * factor))
    }
    viewport.addEventListener('wheel', onWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', onWheel)
  }, [stage])

  useEffect(() => {
    setCamera(defaultCamera(stage))
  }, [stage])

  const beginEdit = (member: number) => {
    if (!editable) return
    setEditing(member)
    setDraft(String(member))
  }

  const commitEdit = () => {
    if (editing === null) return
    const next = Number(draft.trim())
    if (Number.isInteger(next) && next >= 1 && next <= memberCount && next !== editing) {
      onSwap(editing, next)
    }
    setEditing(null)
  }

  useLayoutEffect(() => {
    if (editing === null) return
    const svg = svgRef.current
    const viewport = viewportRef.current
    const pos = positions[editing]
    if (!svg || !viewport || !pos) return
    const screen = stageToClient(pos, svg)
    const box = viewport.getBoundingClientRect()
    const size = Math.max(44, radius * screenScale(svg, camera, stage) * 2.1)
    setEditorPos({
      left: screen.x - box.left,
      top: screen.y - box.top,
      size,
    })
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [camera, editing, positions, radius, stage])

  const endInteraction = (pointerId: number) => {
    const member = draggingRef.current
    const wasClick = mode.current === 'member' && !didDragRef.current && pointers.current.size <= 1
    pointers.current.delete(pointerId)
    if (pointers.current.size < 2 && mode.current === 'pinch') {
      mode.current = pointers.current.size === 1 ? 'pan' : 'none'
    }
    if (pointers.current.size === 0) {
      mode.current = 'none'
      draggingRef.current = null
      didDragRef.current = false
      setDragging(null)
      if (wasClick && member !== null) {
        beginEdit(member)
      }
    }
  }

  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current
    if (!svg) return
    event.preventDefault()
    try {
      svg.setPointerCapture(event.pointerId)
    } catch {
      // some synthetic or lost-pointer cases cannot capture
    }
    const point = clientToStage(event.clientX, event.clientY, svg)
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })

    if (pointers.current.size === 2) {
      const pts = [...pointers.current.values()]
      mode.current = 'pinch'
      draggingRef.current = null
      didDragRef.current = true
      setDragging(null)
      pinchStart.current = {
        distance: distance(pts[0], pts[1]),
        camera,
      }
      return
    }

    const member = hitMember(point, positions, memberCount, hitRadius)
    if (member && editable) {
      mode.current = 'member'
      const pos = positions[member]
      dragOffset.current = { x: point.x - pos.x, y: point.y - pos.y }
      dragStartClient.current = { x: event.clientX, y: event.clientY }
      dragOrigin.current = { x: pos.x, y: pos.y }
      draggingRef.current = member
      didDragRef.current = false
      return
    }

    mode.current = 'pan'
    panStart.current = { point: { x: event.clientX, y: event.clientY }, camera }
  }

  const onMemberPointerDown = (event: React.PointerEvent<SVGGElement>, member: number) => {
    if (!editable) return
    const svg = svgRef.current
    if (!svg) return
    event.preventDefault()
    event.stopPropagation()
    try {
      svg.setPointerCapture(event.pointerId)
    } catch {
      // ignore
    }
    const point = clientToStage(event.clientX, event.clientY, svg)
    const pos = positions[member]
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    mode.current = 'member'
    dragOffset.current = { x: point.x - pos.x, y: point.y - pos.y }
    dragStartClient.current = { x: event.clientX, y: event.clientY }
    dragOrigin.current = { x: pos.x, y: pos.y }
    draggingRef.current = member
    didDragRef.current = false
  }

  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current
    if (!svg) return
    if (!pointers.current.has(event.pointerId)) return
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })

    if (mode.current === 'pinch' && pointers.current.size >= 2) {
      const pts = [...pointers.current.values()]
      const nextDist = distance(pts[0], pts[1])
      if (pinchStart.current.distance <= 0) return
      const mid = {
        x: (pts[0].x + pts[1].x) / 2,
        y: (pts[0].y + pts[1].y) / 2,
      }
      const nextZoom = pinchStart.current.camera.zoom * (nextDist / pinchStart.current.distance)
      setCamera(zoomAt(pinchStart.current.camera, stage, svg, mid.x, mid.y, nextZoom))
      return
    }

    if (mode.current === 'member' && draggingRef.current !== null) {
      if (!didDragRef.current) {
        const travel = Math.hypot(
          event.clientX - dragStartClient.current.x,
          event.clientY - dragStartClient.current.y,
        )
        if (travel < DRAG_THRESHOLD) return
        didDragRef.current = true
        setEditing(null)
        setDragging(draggingRef.current)
      }
      const point = clientToStage(event.clientX, event.clientY, svg)
      const unconstrained = {
        x: point.x - dragOffset.current.x,
        y: point.y - dragOffset.current.y,
      }
      const next = event.ctrlKey ? axisLockedPoint(dragOrigin.current, unconstrained) : unconstrained
      onMove(draggingRef.current, snapMemberOnStage(next, stage, radius))
      return
    }

    if (mode.current === 'pan') {
      const scale = screenScale(svg, panStart.current.camera, stage)
      const dx = (event.clientX - panStart.current.point.x) / scale
      const dy = (event.clientY - panStart.current.point.y) / scale
      setCamera(
        clampCamera(
          {
            zoom: panStart.current.camera.zoom,
            x: panStart.current.camera.x - dx,
            y: panStart.current.camera.y - dy,
          },
          stage,
        ),
      )
    }
  }

  const grid = useMemo(() => {
    const { xs, ys } = stageGrid(stage)
    const lines: { key: string; x1: number; y1: number; x2: number; y2: number }[] = []
    for (const x of xs) {
      lines.push({ key: `v${x}`, x1: x, y1: 0, x2: x, y2: stage.height })
    }
    for (const y of ys) {
      lines.push({ key: `h${y}`, x1: 0, y1: y, x2: stage.width, y2: y })
    }
    return lines
  }, [stage])

  const numbers = Array.from({ length: memberCount }, (_, i) => i + 1)
  const fontSize = memberFontSize(stage, memberCount)
  const dotRadius = pathDotRadius(radius)
  const movePaths = useMemo(() => {
    if (!pathTargets) return []
    const count = Math.max(memberCount, ...Object.keys(pathTargets).map(Number), 0)
    return collectMovePaths(positions, pathTargets, count, radius, 0)
  }, [memberCount, pathTargets, positions, radius])

  return (
    <div className="stage-shell">
      <div className="stage-meta">
        <span>{layoutLabel}</span>
        <span className="stage-hint">不参加的人可拖到画布外；按住 Ctrl 可横向或纵向对齐</span>
        <button type="button" className="ghost" onClick={() => setCamera(defaultCamera(stage))}>
          重置视图
        </button>
      </div>
      <div className="stage-viewport" ref={viewportRef}>
        <svg
          ref={svgRef}
          className="stage-svg"
          viewBox={viewBox(camera, stage)}
          preserveAspectRatio="xMidYMid meet"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(event) => endInteraction(event.pointerId)}
          onPointerCancel={(event) => endInteraction(event.pointerId)}
        >
          <rect
            className="stage-wings"
            x={workspace.x}
            y={workspace.y}
            width={workspace.width}
            height={workspace.height}
          />
          <rect className="stage-floor" x={0} y={0} width={stage.width} height={stage.height} />
          {grid.map((line) => (
            <line
              key={line.key}
              className="stage-grid"
              x1={line.x1}
              y1={line.y1}
              x2={line.x2}
              y2={line.y2}
            />
          ))}
          <rect
            className="stage-border"
            x={2}
            y={2}
            width={stage.width - 4}
            height={stage.height - 4}
          />
          <rect
            className="audience-box"
            x={audience.x}
            y={audience.y}
            width={audience.width}
            height={audience.height}
          />
          <text
            className="sequence-label"
            x={audience.x + audience.padX}
            y={audience.y + audience.height / 2}
            textAnchor="start"
            dominantBaseline="central"
            fontSize={audience.fontSize}
          >
            {sequenceLabel}
          </text>
          <text
            className="audience-label"
            x={stage.width / 2}
            y={audience.y + audience.height / 2}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={audience.fontSize}
          >
            观众席
          </text>
          {movePaths.map((path) => {
            const lineEnd = lineEndBeforeDot(path.x1, path.y1, path.x2, path.y2, dotRadius)
            return (
              <g key={`path-${path.key}`}>
                <line
                  className="stage-path"
                  x1={path.x1}
                  y1={path.y1}
                  x2={lineEnd.x}
                  y2={lineEnd.y}
                />
                <circle className="stage-path-dot" cx={path.x2} cy={path.y2} r={dotRadius} />
              </g>
            )
          })}
          {numbers.map((n) => {
            const pos = positions[n]
            if (!pos) return null
            const active = dragging === n
            const isFree = n > gridCount
            return (
              <g
                key={n}
                className={active ? 'member is-dragging' : 'member'}
                role="button"
                tabIndex={0}
                aria-label={isFree ? `自由人 ${n}` : `队员 ${n}`}
                onPointerDown={(event) => onMemberPointerDown(event, n)}
                onKeyDown={(event) => {
                  if ((event.key === 'Enter' || event.key === ' ') && editable) {
                    event.preventDefault()
                    beginEdit(n)
                  }
                }}
                transform={`translate(${pos.x} ${pos.y})`}
              >
                <circle className="member-hit" r={hitRadius} />
                <circle className="member-body" r={radius} />
                {editing !== n && (
                  <text className="member-label" textAnchor="middle" dominantBaseline="central" fontSize={fontSize}>
                    {n}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
        {editing !== null && (
          <input
            ref={inputRef}
            className="member-edit"
            inputMode="numeric"
            aria-label={`修改队员 ${editing} 的号码`}
            value={draft}
            style={{
              left: editorPos.left,
              top: editorPos.top,
              width: editorPos.size,
              height: editorPos.size,
              fontSize: Math.max(16, editorPos.size * 0.42),
            }}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commitEdit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                commitEdit()
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                setEditing(null)
              }
            }}
            onPointerDown={(event) => event.stopPropagation()}
          />
        )}
      </div>
    </div>
  )
}
