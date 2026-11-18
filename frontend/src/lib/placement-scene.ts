export type MapView = { x: number; y: number; zoom: number }
export type MapBounds = { x: number; y: number; width: number; height: number }
export type PlacementGroup = {
  members: Placement[]
  times: Float64Array
  x: Float64Array
  z: Float64Array
  firstKnown: number
  lastKnown: Int32Array
}
export type Placement = {
  key: string
  x: number
  z: number
  color: string
  icon: string
  label: string
  description: string
  seconds?: number | null
  group?: PlacementGroup
}

export const markerSize = (bounds: MapBounds) =>
  Math.min(bounds.width, bounds.height) * 0.054

// Match SVG's xMidYMid meet projection, including letterboxing in a fitted
// viewport. Rendering, hover, pan and cursor-centered zoom must agree.
export function mapFit(bounds: MapBounds, width: number, height: number) {
  const scale = Math.min(
    (width || 1) / bounds.width,
    (height || 1) / bounds.height,
  )
  return {
    scale,
    width: bounds.width * scale,
    height: bounds.height * scale,
    left: (width - bounds.width * scale) / 2,
    top: (height - bounds.height * scale) / 2,
  }
}

export function visiblePlacement(
  placement: Pick<Placement, 'x' | 'z'>,
  bounds: MapBounds,
  view: MapView,
  fit = mapFit(bounds, bounds.width, bounds.height),
) {
  const half = (markerSize(bounds) * 0.55) / view.zoom
  // SVG content can extend beyond the viewBox into its letterboxing when
  // zoomed. Cull against the full viewport, not just the nominal viewBox.
  const paddingX = fit.left / (fit.scale * view.zoom)
  const paddingY = fit.top / (fit.scale * view.zoom)
  return (
    placement.x + half >= view.x - paddingX &&
    placement.z + half >= view.y - paddingY &&
    placement.x - half <= view.x + bounds.width / view.zoom + paddingX &&
    placement.z - half <= view.y + bounds.height / view.zoom + paddingY
  )
}

// Reverse order matches the painter's order when icons overlap.
export function placementAt(
  placements: Placement[],
  bounds: MapBounds,
  view: MapView,
  x: number,
  z: number,
) {
  const half = (markerSize(bounds) * 0.55) / view.zoom
  for (let i = placements.length - 1; i >= 0; i--) {
    const placement = placements[i]
    if (Math.abs(placement.x - x) <= half && Math.abs(placement.z - z) <= half)
      return placement
  }
  return null
}

export type PlacementScene = {
  setPlacements: (placements: Placement[], version: number) => void
  setTime: (cutoff: number, colorByTime: boolean) => void
  setViewport: (bounds: MapBounds, view: MapView) => void
  resize: (width: number, height: number) => void
  destroy: () => void
}
