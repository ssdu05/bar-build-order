import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPlacementScene } from './canvas-placement-scene'
import { createPlacementIndex } from './placement-clusters'
import { buildTimeColors, unknownBuildTimeColor } from './build-time-colors'
import type { Placement } from './placement-scene'

class FakeImage {
  static instances: FakeImage[] = []
  src = ''
  decoding = ''
  complete = false
  naturalWidth = 32
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor() { FakeImage.instances.push(this) }
}
const context = {
  setTransform: vi.fn(),
  clearRect: vi.fn(),
  fillRect: vi.fn(),
  fillText: vi.fn(),
  drawImage: vi.fn(),
  fillStyle: '',
  font: '',
  textAlign: '',
  textBaseline: '',
}
const placement: Placement = {
  key: '1', x: 200, z: 100, color: '#fff', icon: '/unit.png',
  label: 'Unit', description: 'Details', seconds: 1,
}
const bounds = { x: 0, y: 0, width: 1000, height: 500 }
const view = { x: 0, y: 0, zoom: 1 }
let callbacks: Map<number, FrameRequestCallback>
let fills: string[]

function flushFrame() {
  const pending = [...callbacks.values()]
  callbacks.clear()
  for (const callback of pending) callback(0)
}

beforeEach(() => {
  callbacks = new Map()
  fills = []
  let id = 0
  FakeImage.instances = []
  context.fillRect.mockImplementation(() => { fills.push(context.fillStyle) })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue(context as unknown as CanvasRenderingContext2D)
  vi.stubGlobal('Image', FakeImage)
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
    callbacks.set(++id, callback)
    return id
  }))
  vi.stubGlobal('cancelAnimationFrame', vi.fn((key: number) => callbacks.delete(key)))
})

describe('canvas placement rendering', () => {
  it('batches updates, culls offscreen placements and keeps icon size fixed when zooming', async () => {
    vi.stubGlobal('devicePixelRatio', 2)
    const host = document.createElement('div')
    const scene = (await createPlacementScene(host, new AbortController().signal))!
    scene.setPlacements([placement, { ...placement, key: '2', x: 900 }], 1)
    scene.resize(1000, 500)
    scene.setViewport(bounds, { ...view, zoom: 2 })
    scene.setViewport(bounds, { ...view, zoom: 4 })
    expect(callbacks.size).toBe(1)
    expect(context.clearRect).not.toHaveBeenCalled()
    flushFrame()
    expect(host.querySelector('canvas')!.width).toBe(2000)
    expect(context.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0)
    expect(context.fillRect).toHaveBeenCalledTimes(2) // One frame and background.
    const first = context.fillRect.mock.calls[0]
    expect(first[0]).toBeCloseTo(800 - 27 * 0.55)
    expect(first[1]).toBeCloseTo(400 - 27 * 0.55)
    expect(first[2]).toBeCloseTo(27 * 1.1)
    expect(callbacks.size).toBe(0) // No idle animation loop.
    scene.setViewport(bounds, { ...view, zoom: 2 })
    flushFrame()
    expect(context.fillRect.mock.calls[2][2]).toBe(first[2])
    scene.destroy()
    expect(host.childElementCount).toBe(0)
  })

  it.each([
    { width: 1000, height: 500, axis: 'x' as const },
    { width: 500, height: 1000, axis: 'z' as const },
  ])('renders across the full $width×$height viewport when zoomed and panned', async ({ width, height, axis }) => {
    const scene = (await createPlacementScene(
      document.createElement('div'), new AbortController().signal,
    ))!
    const square = { x: 0, y: 0, width: 1000, height: 1000 }
    scene.setPlacements([240, 245, 300, 700, 755, 760].map((coordinate) => ({
      ...placement, key: String(coordinate), x: 500, z: 500, [axis]: coordinate,
    })), 1)
    scene.resize(width, height)
    scene.setViewport(square, { x: 375, y: 375, zoom: 4 })
    flushFrame()
    // Both sides of the nominal viewBox are visible, including partial icons
    // at the actual viewport edges. Fully offscreen icons are still culled.
    expect(context.fillRect).toHaveBeenCalledTimes(8)
    const coordinateIndex = axis === 'x' ? 0 : 1
    for (const [index, center] of [-10, 100, 900, 1010].entries()) {
      const frame = context.fillRect.mock.calls[index * 2]
      expect(frame[coordinateIndex]).toBeCloseTo(center - 27 * 0.55)
      expect(frame[2]).toBeCloseTo(27 * 1.1)
    }
    scene.destroy()
  })

  it('scrubs an 8,000-record cluster using scalar time updates and a single badge', async () => {
    const points = Array.from({ length: 8000 }, (_, index) => ({
      ...placement, key: String(index), seconds: index,
    }))
    const clusters = createPlacementIndex(points, bounds).atZoom(0)
    expect(clusters).toHaveLength(1)
    const members = clusters[0].group!.members
    const scene = (await createPlacementScene(
      document.createElement('div'), new AbortController().signal,
    ))!
    scene.setPlacements(clusters, 1)
    scene.resize(1000, 500)
    scene.setViewport(bounds, view)
    for (const time of [0, 7000, 100, 4000]) scene.setTime(time, false)
    expect(callbacks.size).toBe(1)
    flushFrame()
    expect(context.fillText).toHaveBeenCalledWith('4001', 200, 100)
    expect(context.fillRect).toHaveBeenCalledTimes(2)
    expect(FakeImage.instances).toHaveLength(0)
    expect(clusters[0].group!.members).toBe(members)
    scene.setTime(7999, false)
    flushFrame()
    expect(context.fillText).toHaveBeenLastCalledWith('8000', 200, 100)
    scene.destroy()
  })

  it('rescales build-time colors for the current cutoff, including unknown times', async () => {
    const scene = (await createPlacementScene(
      document.createElement('div'), new AbortController().signal,
    ))!
    scene.setPlacements([
      placement,
      { ...placement, key: '2', seconds: 5 },
      { ...placement, key: '3', seconds: 10 },
      { ...placement, key: '4', seconds: null },
    ], 1)
    scene.resize(1000, 500)
    scene.setViewport(bounds, view)
    scene.setTime(10, true)
    flushFrame()
    expect(fills[0]).toBe(buildTimeColors[0])
    expect(fills[4]).toBe(buildTimeColors[2])
    expect(fills[6]).toBe(unknownBuildTimeColor)
    fills.length = 0
    scene.setTime(5, true)
    flushFrame()
    expect(fills[2]).toBe(buildTimeColors[2])
    fills.length = 0
    scene.setTime(1, true)
    flushFrame()
    expect(fills[0]).toBe(buildTimeColors[1])
    scene.destroy()
  })

  it('shares artwork and fallbacks, keeps images across filtering and refreshes on version changes', async () => {
    const scene = (await createPlacementScene(
      document.createElement('div'), new AbortController().signal,
    ))!
    scene.setPlacements([placement, { ...placement, key: '2' }], 1)
    scene.resize(1000, 500)
    scene.setViewport(bounds, view)
    flushFrame()
    expect(FakeImage.instances).toHaveLength(2) // One artwork URL and one fallback.
    const [image, fallback] = FakeImage.instances
    image.complete = true
    image.naturalWidth = 0
    image.onerror!()
    fallback.complete = true
    fallback.onload!()
    flushFrame()
    expect(context.drawImage).toHaveBeenCalledWith(fallback, expect.any(Number),
      expect.any(Number), expect.any(Number), expect.any(Number))
    scene.setPlacements([placement], 1)
    scene.setTime(5, false)
    flushFrame()
    expect(FakeImage.instances).toHaveLength(2)
    scene.setPlacements([placement], 2)
    flushFrame()
    expect(FakeImage.instances).toHaveLength(4)
    expect(image.onload).toBeNull()
    scene.destroy()
    expect(FakeImage.instances[2].onload).toBeNull()
    expect(callbacks.size).toBe(0)
  })

  it('cancels scheduled rendering on disposal and handles unavailable canvas or cancellation', async () => {
    const host = document.createElement('div')
    const scene = (await createPlacementScene(host, new AbortController().signal))!
    scene.setPlacements([placement], 1)
    expect(callbacks.size).toBe(1)
    scene.destroy()
    scene.destroy()
    expect(callbacks.size).toBe(0)
    expect(host.childElementCount).toBe(0)
    const controller = new AbortController()
    controller.abort()
    expect(await createPlacementScene(host, controller.signal)).toBeNull()
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null)
    await expect(createPlacementScene(host, new AbortController().signal))
      .rejects.toThrow('Canvas2D is unavailable')
  })
})
