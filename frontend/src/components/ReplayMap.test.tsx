import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseRecording } from '@/lib/recording'
import { csv, csvFor, entriesFixture, url } from '@/test/fixtures'
import { CanvasPlacements } from './CanvasPlacements'
import { ReplayMap } from './ReplayMap'
import { createRecordingTimeline } from '@/lib/recording-timeline'
import { placementAtTime } from '@/lib/placement-clusters'

vi.mock('./CanvasPlacements', () => ({
  CanvasPlacements: vi.fn(() => null),
}))

let callbacks: Map<number, FrameRequestCallback>
beforeEach(() => {
  callbacks = new Map()
  let id = 0
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback: FrameRequestCallback) => {
      callbacks.set(++id, callback)
      return id
    }),
  )
  vi.stubGlobal(
    'cancelAnimationFrame',
    vi.fn((key: number) => callbacks.delete(key)),
  )
})

function mount(rows = parseRecording(csv)) {
  const props = {
    api: entriesFixture()[url].bar_api,
    url,
    version: 1,
    rows,
    allRows: rows,
    onFilter: () => {},
  }
  const result = render(<ReplayMap {...props} />)
  const map = screen.getByRole('group', { name: 'Build placements on Aurelia' })
  vi.spyOn(map, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: 7168,
    height: 7168,
    right: 7168,
    bottom: 7168,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  })
  return { ...result, map, props }
}

function flushFrame() {
  act(() => {
    const pending = [...callbacks.values()]
    callbacks.clear()
    for (const callback of pending) callback(0)
  })
}

describe('recording map interaction', () => {
  it('starts unclustered and supports enabling clustering, scrubbing and disabling it again', () => {
    vi.spyOn(SVGSVGElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 1000, height: 500,
      right: 1000, bottom: 500, x: 0, y: 0, toJSON: () => ({}),
    })
    const rows = parseRecording(csvFor(...[1, 5, 10].map((seconds) => ({
      player: 'Alice', building: 'Unit', start_seconds: String(seconds),
      x: '100', z: '100',
    }))))
    const timeline = createRecordingTimeline(10)
    render(<ReplayMap
      api={entriesFixture()[url].bar_api}
      url={url}
      version={1}
      rows={rows}
      allRows={rows}
      timeline={timeline}
      onFilter={() => {}}
    />)
    const props = () => vi.mocked(CanvasPlacements).mock.lastCall![0]
    const toggle = screen.getByRole('checkbox', { name: 'Cluster nearby placements' })
    expect(toggle).not.toBeChecked()
    expect(props().placements).toHaveLength(3)
    fireEvent.click(toggle)
    expect(toggle).toBeChecked()
    const clusters = props().placements
    expect(clusters).toHaveLength(1)
    expect(placementAtTime(clusters[0], 10)?.count).toBe(3)
    const map = screen.getByRole('group', { name: 'Build placements on Aurelia' })
    expect(map).toHaveAttribute('aria-description', expect.stringContaining('3 build placements in 1 map marker'))
    act(() => {
      timeline.begin()
      timeline.preview(5)
    })
    expect(props().placements).toBe(clusters)
    expect(placementAtTime(clusters[0], timeline.getSnapshot())?.count).toBe(2)
    fireEvent(map, new MouseEvent('pointermove', {
      bubbles: true, clientX: 250 + 100 * 500 / 7168, clientY: 100 * 500 / 7168,
    }))
    expect(screen.getByRole('tooltip')).toHaveTextContent('2 nearby build records')
    fireEvent.click(toggle)
    expect(toggle).not.toBeChecked()
    expect(props().placements).toHaveLength(3)
    expect(map).toHaveAttribute('aria-description', expect.stringContaining('2 build placements in 2 map markers'))
    timeline.dispose()
  })

  it('reuses prepared placements for retained records during time filtering', () => {
    const { rerender, props } = mount()
    const original = vi.mocked(CanvasPlacements).mock.lastCall![0].placements
    rerender(<ReplayMap {...props} rows={props.rows.slice(0, 2)} />)
    const filtered = vi.mocked(CanvasPlacements).mock.lastCall![0].placements
    expect(filtered[0]).toBe(original[0])
    expect(filtered[1]).toBe(original[1])
    rerender(<ReplayMap {...props} />)
    expect(vi.mocked(CanvasPlacements).mock.lastCall![0].placements[2]).toBe(original[2])
    rerender(<ReplayMap {...props} version={2} />)
    expect(vi.mocked(CanvasPlacements).mock.lastCall![0].placements[0]).not.toBe(original[0])
  })

  it('lets normal scrolling pass through the overview map and requires Ctrl or Cmd to wheel-zoom', () => {
    render(
      <ReplayMap
        api={entriesFixture()[url].bar_api}
        url={url}
        version={1}
        onFilter={() => {}}
      />,
    )
    const map = screen.getByRole('group', { name: 'Player spawns on Aurelia' })
    const initial = map.getAttribute('viewBox')
    const scroll = () =>
      new WheelEvent('wheel', {
        deltaY: -50,
        bubbles: true,
        cancelable: true,
      })
    const ordinary = scroll()
    fireEvent(map, ordinary)
    expect(ordinary.defaultPrevented).toBe(false)
    expect(callbacks.size).toBe(0)
    expect(map).toHaveAttribute('viewBox', initial)
    expect(map.getAttribute('aria-description')).toContain(
      'Ctrl / Cmd + scroll',
    )
    for (const modifier of ['ctrlKey', 'metaKey']) {
      const before = map.getAttribute('viewBox')
      const zoom = new WheelEvent('wheel', {
        deltaY: -50,
        bubbles: true,
        cancelable: true,
        [modifier]: true,
      })
      fireEvent(map, zoom)
      expect(zoom.defaultPrevented).toBe(true)
      flushFrame()
      expect(map.getAttribute('viewBox')).not.toBe(before)
    }
    const zoomed = map.getAttribute('viewBox')
    const ordinaryWhileZoomed = scroll()
    fireEvent(map, ordinaryWhileZoomed)
    expect(ordinaryWhileZoomed.defaultPrevented).toBe(false)
    expect(map).toHaveAttribute('viewBox', zoomed)
  })

  it('expands the existing map, isolates background controls, and restores focus and state on Escape', () => {
    const background = document.createElement('button')
    background.textContent = 'Background'
    background.setAttribute('aria-hidden', 'false')
    document.body.appendChild(background)
    const { map, unmount } = mount()
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Color outlines by build time' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    flushFrame()
    const viewBox = map.getAttribute('viewBox')
    const placements = vi.mocked(CanvasPlacements).mock.calls.at(-1)![0]
      .placements
    fireEvent.click(screen.getByRole('button', { name: 'Expand map' }))
    const dialog = screen.getByRole('dialog', { name: 'Expanded recorded map' })
    expect(dialog).toContainElement(map)
    expect(map).toHaveAttribute('viewBox', viewBox)
    expect(vi.mocked(CanvasPlacements).mock.calls.at(-1)![0].placements).toBe(
      placements,
    )
    expect(
      screen.getByRole('button', { name: 'Exit expanded map' }),
    ).toHaveFocus()
    expect(background.inert).toBe(true)
    expect(background).toHaveAttribute('aria-hidden', 'true')
    expect(document.body.style.overflow).toBe('hidden')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(background.inert).toBeFalsy()
    expect(background).toHaveAttribute('aria-hidden', 'false')
    expect(document.body.style.overflow).toBe('')
    expect(screen.getByRole('button', { name: 'Expand map' })).toHaveFocus()
    expect(map).toHaveAttribute('viewBox', viewBox)
    expect(
      screen.getByRole('checkbox', { name: 'Color outlines by build time' }),
    ).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Expand map' }))
    unmount()
    expect(background).toHaveAttribute('aria-hidden', 'false')
    expect(document.body.style.overflow).toBe('')
    background.remove()
  })

  it('keeps hover and cursor-centered zoom aligned inside a letterboxed viewport', () => {
    const { map } = mount()
    vi.mocked(map.getBoundingClientRect).mockReturnValue({
      left: 0,
      top: 0,
      width: 1000,
      height: 500,
      right: 1000,
      bottom: 500,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    // The square map occupies x=250..750, not the full 1000px viewport.
    fireEvent(
      map,
      new MouseEvent('pointermove', {
        bubbles: true,
        clientX: 250 + (600 * 500) / 7168,
        clientY: (800 * 500) / 7168,
      }),
    )
    expect(screen.getByRole('tooltip')).toHaveTextContent('Bob: Pawn')
    fireEvent.wheel(map, { deltaY: -50, clientX: 500, clientY: 250 })
    flushFrame()
    const view = vi.mocked(CanvasPlacements).mock.calls.at(-1)![0].view
    expect(view.x + 7168 / view.zoom / 2).toBeCloseTo(3584)
    expect(view.y + 7168 / view.zoom / 2).toBeCloseTo(3584)
  })

  it('toggles time colors, rescales with map selection, and preserves zoom and spawn colors', () => {
    const { map, props, rerender } = mount()
    const sceneProps = () => vi.mocked(CanvasPlacements).mock.calls.at(-1)![0]
    const playerColors = sceneProps().placements.map((p) => p.color)
    const spawn = screen
      .getByRole('img', { name: '1. Alice' })
      .querySelector('circle')!
    const spawnColor = spawn.getAttribute('fill')
    const toggle = screen.getByRole('checkbox', {
      name: 'Color outlines by build time',
    })
    expect(toggle).not.toBeChecked()
    expect(
      screen.queryByRole('group', { name: 'Build time color legend' }),
    ).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    flushFrame()
    const viewBox = map.getAttribute('viewBox')
    fireEvent.click(toggle)
    expect(sceneProps().colorByTime).toBe(true)
    expect(sceneProps().placements.map((p) => p.color)).toEqual(playerColors)
    expect(
      screen.getByRole('group', { name: 'Build time color legend' }),
    ).toHaveTextContent('Earlier · 00:01')
    expect(screen.getByText('Later · 00:08')).toBeInTheDocument()
    expect(map).toHaveAttribute('viewBox', viewBox)
    expect(spawn).toHaveAttribute('fill', spawnColor)

    rerender(<ReplayMap {...props} rows={props.rows.slice(1)} />)
    expect(toggle).toBeChecked()
    expect(sceneProps().placements.map((p) => p.seconds)).toEqual([5, 8])
    expect(screen.getByText('Earlier · 00:05')).toBeInTheDocument()
    rerender(<ReplayMap {...props} rows={props.rows.slice(1, 2)} />)
    expect(screen.getByText('All timed placements: 00:05')).toBeInTheDocument()
    expect(sceneProps().colorByTime).toBe(true)

    fireEvent.click(toggle)
    expect(sceneProps().placements[0].color).toBe(playerColors[1])
    expect(
      screen.queryByRole('group', { name: 'Build time color legend' }),
    ).toBeNull()
    expect(map).toHaveAttribute('viewBox', viewBox)
  })

  it('ignores unplottable records when computing the gradient and labels unknown times', () => {
    mount(
      parseRecording(
        csvFor(
          { start_seconds: '0', x: '', z: '' },
          { start_seconds: '5', x: '100', z: '100' },
          { start_seconds: '10', x: '8000', z: '100' },
          { x: '200', z: '200' },
        ),
      ),
    )
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Color outlines by build time' }),
    )
    const placements = vi.mocked(CanvasPlacements).mock.calls.at(-1)![0]
      .placements
    expect(placements.map((p) => p.seconds)).toEqual([null, 5])
    expect(screen.getByText('All timed placements: 00:05')).toBeInTheDocument()
    expect(screen.getByText('Unknown time · 1')).toBeInTheDocument()
  })

  it('does not offer build-time coloring on the ordinary replay spawn map', () => {
    render(
      <ReplayMap
        api={entriesFixture()[url].bar_api}
        url={url}
        version={1}
        onFilter={() => {}}
      />,
    )
    expect(
      screen.queryByRole('checkbox', { name: 'Color outlines by build time' }),
    ).toBeNull()
  })

  it('accumulates wheel zoom once per frame without recomputing placements', () => {
    const { map, unmount } = mount()
    const calls = vi.mocked(CanvasPlacements).mock.calls
    const placements = calls.at(-1)![0].placements
    const initial = map.getAttribute('viewBox')
    fireEvent.wheel(map, { deltaY: -50, clientX: 3584, clientY: 3584 })
    fireEvent.wheel(map, { deltaY: -50, clientX: 3584, clientY: 3584 })
    expect(callbacks.size).toBe(1)
    expect(map).toHaveAttribute('viewBox', initial)
    flushFrame()
    expect(calls.at(-1)![0].view.zoom).toBeCloseTo(Math.exp(0.8))
    expect(calls.at(-1)![0].placements).toBe(placements)
    fireEvent.wheel(map, { deltaY: -50, clientX: 3584, clientY: 3584 })
    flushFrame()
    expect(calls.at(-1)![0].view.zoom).toBeCloseTo(Math.exp(1.2))
    fireEvent.wheel(map, { deltaY: -50 })
    unmount()
    expect(callbacks.size).toBe(0)
  })

  it('shows placement details on hover and clears them when leaving or zooming', () => {
    const { map } = mount()
    const hover = () =>
      fireEvent(
        map,
        new MouseEvent('pointermove', {
          bubbles: true,
          clientX: 600,
          clientY: 800,
        }),
      )
    hover()
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      'Bob: Pawn · 00:08 · Completed · X 600, Z 800',
    )
    fireEvent.pointerLeave(map)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    hover()
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })
})
