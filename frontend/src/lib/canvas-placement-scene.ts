import { buildTimeColor, buildTimeRange } from './build-time-colors'
import { placementAtTime } from './placement-clusters'
import {
  mapFit,
  markerSize,
  visiblePlacement,
  type MapBounds,
  type MapView,
  type Placement,
  type PlacementScene,
} from './placement-scene'

const placeholder = '/unit-placeholder.svg'

// Clustering bounds the number of visible icons. Native Canvas2D is enough
// for this overlay and avoids depending on WebGL/GPU acceleration for smooth
// scrubbing. Artwork and glyph rasterization are cached by the browser.
export async function createPlacementScene(
  host: HTMLElement,
  signal: AbortSignal,
): Promise<PlacementScene | null> {
  if (signal.aborted) return null
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas2D is unavailable')
  canvas.setAttribute('aria-hidden', 'true')
  canvas.style.display = 'block'
  canvas.style.width = canvas.style.height = '100%'
  host.appendChild(canvas)
  const resolution = Math.min(window.devicePixelRatio || 1, 2)
  let disposed = false
  let frame: number | null = null
  let width = 0
  let height = 0
  let bounds: MapBounds | null = null
  let view: MapView = { x: 0, y: 0, zoom: 1 }
  let cutoff = Infinity
  let colorByTime = false
  let placements: Placement[] = []
  let version: number | undefined
  const images = new Map<string, HTMLImageElement>()
  const invalidate = () => {
    if (!disposed && frame === null) frame = requestAnimationFrame(draw)
  }
  const imageFor = (url: string): HTMLImageElement | null => {
    let image = images.get(url)
    if (!image) {
      image = new Image()
      image.decoding = 'async'
      image.onload = image.onerror = invalidate
      images.set(url, image)
      image.src = url
    }
    if (image.complete && image.naturalWidth) return image
    return url !== placeholder ? imageFor(placeholder) : null
  }
  const clearImages = () => {
    for (const image of images.values()) {
      image.onload = image.onerror = null
      if (!image.complete) image.src = ''
    }
    images.clear()
  }
  const draw = () => {
    frame = null
    if (disposed || !bounds || !width || !height) return
    context.setTransform(resolution, 0, 0, resolution, 0, 0)
    context.clearRect(0, 0, width, height)
    const fit = mapFit(bounds, width, height)
    const size = markerSize(bounds) * fit.scale
    const displayed = placements.map((placement) => ({
      placement, point: placementAtTime(placement, cutoff),
    }))
    const range = colorByTime
      ? buildTimeRange(displayed.flatMap(({ point }) =>
          point ? [point.first, point.last] : []))
      : null
    for (const { placement, point } of displayed) {
      if (!point || !visiblePlacement(point, bounds, view, fit)) continue
      const x = fit.left + (point.x - view.x) * fit.scale * view.zoom
      const y = fit.top + (point.z - view.y) * fit.scale * view.zoom
      context.fillStyle = range
        ? buildTimeColor(point.last, range.first, range.last)
        : point.single?.color || placement.color
      context.fillRect(x - size * 0.55, y - size * 0.55, size * 1.1, size * 1.1)
      context.fillStyle = '#101823'
      context.fillRect(x - size * 0.46, y - size * 0.46, size * 0.92, size * 0.92)
      if (point.count > 1) {
        const text = String(point.count)
        context.fillStyle = '#ffffff'
        context.font = `bold ${Math.min(size * 0.7, size * 0.8 / (text.length * 0.62))}px monospace`
        context.textAlign = 'center'
        context.textBaseline = 'middle'
        context.fillText(text, x, y)
      } else if (point.single) {
        const image = imageFor(point.single.icon)
        if (image)
          context.drawImage(
            image,
            x - size * 0.44, y - size * 0.44,
            size * 0.88, size * 0.88,
          )
      }
    }
  }
  return {
    setPlacements(next, nextVersion) {
      if (version !== nextVersion) clearImages()
      version = nextVersion
      placements = next
      invalidate()
    },
    setTime(nextCutoff, nextColorByTime) {
      cutoff = nextCutoff
      colorByTime = nextColorByTime
      invalidate()
    },
    setViewport(nextBounds, nextView) {
      bounds = nextBounds
      view = nextView
      invalidate()
    },
    resize(nextWidth, nextHeight) {
      width = nextWidth
      height = nextHeight
      canvas.width = Math.max(1, Math.round(width * resolution))
      canvas.height = Math.max(1, Math.round(height * resolution))
      invalidate()
    },
    destroy() {
      if (disposed) return
      disposed = true
      if (frame !== null) cancelAnimationFrame(frame)
      clearImages()
      canvas.remove()
    },
  }
}
