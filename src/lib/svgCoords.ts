import type { Point, StageSize } from '../types'
import { workspaceRect } from './positions'

export type Camera = {
  x: number
  y: number
  zoom: number
}

export function defaultCamera(stage: StageSize): Camera {
  const workspace = workspaceRect(stage)
  return { x: workspace.x, y: workspace.y, zoom: 1 }
}

export const DEFAULT_CAMERA: Camera = { x: 0, y: 0, zoom: 1 }

export function viewBox(camera: Camera, stage: StageSize): string {
  const workspace = workspaceRect(stage)
  return `${camera.x} ${camera.y} ${workspace.width / camera.zoom} ${workspace.height / camera.zoom}`
}

export function clientToStage(clientX: number, clientY: number, svg: SVGSVGElement): Point {
  const ctm = svg.getScreenCTM()
  if (ctm) {
    const mapped = new DOMPointReadOnly(clientX, clientY).matrixTransform(ctm.inverse())
    return { x: mapped.x, y: mapped.y }
  }
  return { x: 0, y: 0 }
}

export function clientToStageWithCamera(
  clientX: number,
  clientY: number,
  svg: SVGSVGElement,
  camera: Camera,
  stage: StageSize,
): Point {
  const rect = svg.getBoundingClientRect()
  const workspace = workspaceRect(stage)
  const vbW = workspace.width / camera.zoom
  const vbH = workspace.height / camera.zoom
  const scale = Math.min(rect.width / vbW, rect.height / vbH)
  const drawnW = vbW * scale
  const drawnH = vbH * scale
  const ox = rect.left + (rect.width - drawnW) / 2
  const oy = rect.top + (rect.height - drawnH) / 2
  return {
    x: camera.x + (clientX - ox) / scale,
    y: camera.y + (clientY - oy) / scale,
  }
}

export function screenScale(svg: SVGSVGElement, camera: Camera, stage: StageSize): number {
  const rect = svg.getBoundingClientRect()
  const workspace = workspaceRect(stage)
  const vbW = workspace.width / camera.zoom
  const vbH = workspace.height / camera.zoom
  return Math.min(rect.width / vbW, rect.height / vbH)
}

export function clampCamera(camera: Camera, stage: StageSize): Camera {
  const workspace = workspaceRect(stage)
  const zoom = Math.min(6, Math.max(0.55, camera.zoom))
  const vbW = workspace.width / zoom
  const vbH = workspace.height / zoom
  const padX = workspace.width * 0.08
  const padY = workspace.height * 0.08
  const minX = workspace.x - padX
  const minY = workspace.y - padY
  const maxX = workspace.x + workspace.width - vbW + padX
  const maxY = workspace.y + workspace.height - vbH + padY
  return {
    zoom,
    x: Math.min(maxX, Math.max(minX, camera.x)),
    y: Math.min(maxY, Math.max(minY, camera.y)),
  }
}

export function zoomAt(
  camera: Camera,
  stage: StageSize,
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
  nextZoom: number,
): Camera {
  const before = clientToStageWithCamera(clientX, clientY, svg, camera, stage)
  const zoomed = { ...camera, zoom: nextZoom }
  const after = clientToStageWithCamera(clientX, clientY, svg, zoomed, stage)
  return clampCamera(
    {
      zoom: nextZoom,
      x: camera.x + (before.x - after.x),
      y: camera.y + (before.y - after.y),
    },
    stage,
  )
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function stageToClient(point: Point, svg: SVGSVGElement): Point {
  const ctm = svg.getScreenCTM()
  if (!ctm) return { x: 0, y: 0 }
  const mapped = new DOMPointReadOnly(point.x, point.y).matrixTransform(ctm)
  return { x: mapped.x, y: mapped.y }
}
