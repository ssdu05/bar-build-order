import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CanvasPlacements, type CanvasPlacementsProps } from './CanvasPlacements'
import { createPlacementScene } from '@/lib/canvas-placement-scene'
import type { PlacementScene } from '@/lib/placement-scene'
import { createRecordingTimeline } from '@/lib/recording-timeline'

vi.mock('@/lib/canvas-placement-scene', () => ({
  createPlacementScene: vi.fn(),
}))

const props: CanvasPlacementsProps = {
  placements: [],
  bounds: { x: 0, y: 0, width: 1000, height: 500 },
  view: { x: 0, y: 0, zoom: 1 },
  version: 1,
}
let renderer: PlacementScene

beforeEach(() => {
  renderer = {
    setPlacements: vi.fn(),
    setTime: vi.fn(),
    setViewport: vi.fn(),
    resize: vi.fn(),
    destroy: vi.fn(),
  }
  vi.mocked(createPlacementScene).mockResolvedValue(renderer)
})

describe('Canvas placement lifecycle', () => {
  it('sends only scalar time updates to the loaded renderer while scrubbing', async () => {
    const timeline = createRecordingTimeline(8000)
    const { unmount } = render(<CanvasPlacements {...props} timeline={timeline} />)
    await waitFor(() => expect(renderer.setPlacements).toHaveBeenCalledTimes(1))
    act(() => {
      timeline.begin()
      timeline.preview(6000)
      timeline.preview(7000)
      timeline.preview(7900)
    })
    expect(renderer.setTime).toHaveBeenLastCalledWith(7900, false)
    expect(renderer.setPlacements).toHaveBeenCalledTimes(1)
    unmount()
    const calls = vi.mocked(renderer.setTime).mock.calls.length
    timeline.preview(1000)
    expect(renderer.setTime).toHaveBeenCalledTimes(calls)
    timeline.dispose()
  })

  it('renders 8,000 records without creating per-placement DOM elements', async () => {
    vi.mocked(createPlacementScene).mockImplementation(async (host) => {
      host.appendChild(document.createElement('canvas'))
      return renderer
    })
    const placements = Array.from({ length: 8000 }, (_, i) => ({
      key: String(i),
      x: i,
      z: i,
      color: '#fff',
      icon: '/unit.png',
      label: `Unit ${i}`,
      description: 'Details',
    }))
    const { container } = render(
      <CanvasPlacements {...props} placements={placements} />,
    )
    await waitFor(() =>
      expect(renderer.setPlacements).toHaveBeenCalledWith(placements, 1),
    )
    expect(container.querySelectorAll('canvas')).toHaveLength(1)
    expect(container.querySelectorAll('*')).toHaveLength(2)
  })

  it('updates only the viewport during zoom and cleans up on unmount', async () => {
    const { rerender, unmount } = render(<CanvasPlacements {...props} />)
    await waitFor(() => expect(renderer.setPlacements).toHaveBeenCalledTimes(1))
    const view = { ...props.view, zoom: 2 }
    rerender(<CanvasPlacements {...props} view={view} />)
    expect(renderer.setViewport).toHaveBeenLastCalledWith(props.bounds, view)
    expect(renderer.setPlacements).toHaveBeenCalledTimes(1)
    const placements = [
      {
        key: '1',
        x: 1,
        z: 1,
        color: '#fff',
        icon: '/unit.png',
        label: 'Unit',
        description: 'Details',
      },
    ]
    rerender(<CanvasPlacements {...props} placements={placements} version={2} />)
    expect(renderer.setPlacements).toHaveBeenLastCalledWith(placements, 2)
    unmount()
    expect(renderer.destroy).toHaveBeenCalledTimes(1)
    expect(vi.mocked(createPlacementScene).mock.calls[0][1].aborted).toBe(true)
  })

  it('destroys a renderer that finishes initializing after unmount', async () => {
    let resolve!: (value: PlacementScene) => void
    vi.mocked(createPlacementScene).mockReturnValue(
      new Promise((done) => {
        resolve = done
      }),
    )
    const { unmount } = render(<CanvasPlacements {...props} />)
    await waitFor(() => expect(createPlacementScene).toHaveBeenCalled())
    unmount()
    await act(async () => {
      resolve(renderer)
    })
    expect(renderer.destroy).toHaveBeenCalledTimes(1)
    expect(renderer.setPlacements).not.toHaveBeenCalled()
  })

  it('shows an actionable message when canvas initialization fails', async () => {
    vi.mocked(createPlacementScene).mockRejectedValue(new Error('No Canvas2D'))
    render(<CanvasPlacements {...props} />)
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Map rendering is unavailable',
    )
  })
})
