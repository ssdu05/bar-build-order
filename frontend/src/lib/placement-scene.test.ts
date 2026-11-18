import { describe, expect, it } from 'vitest'
import {
  markerSize,
  mapFit,
  placementAt,
  visiblePlacement,
  type Placement,
} from './placement-scene'

const bounds = { x: 0, y: 0, width: 1000, height: 500 }
const view = { x: 100, y: 50, zoom: 2 }
const placement: Placement = {
  key: '1',
  x: 200,
  z: 100,
  color: '#fff',
  icon: '/unit.png',
  label: 'Unit',
  description: 'Unit details',
}

describe('placement geometry', () => {
  it('fits maps against both viewport dimensions with centered letterboxing', () => {
    expect(mapFit(bounds, 500, 500)).toEqual({
      scale: 0.5,
      width: 500,
      height: 250,
      left: 0,
      top: 125,
    })
    expect(mapFit(bounds, 1000, 250)).toEqual({
      scale: 0.5,
      width: 500,
      height: 250,
      left: 250,
      top: 0,
    })
  })

  it('culls outside the viewport but retains partially visible icon borders', () => {
    expect(visiblePlacement(placement, bounds, view)).toBe(true)
    expect(visiblePlacement({ ...placement, x: 0 }, bounds, view)).toBe(false)
    expect(visiblePlacement({ ...placement, x: 99 }, bounds, view)).toBe(true)
    expect(visiblePlacement({ ...placement, x: 601 }, bounds, view)).toBe(true)
    expect(visiblePlacement({ ...placement, z: 400 }, bounds, view)).toBe(false)
  })

  it('includes the visible area beyond a zoomed viewBox in letterboxed layouts', () => {
    const wide = mapFit(bounds, 1000, 250)
    expect(visiblePlacement({ x: 0, z: 100 }, bounds, view, wide)).toBe(true)
    expect(visiblePlacement({ x: 800, z: 100 }, bounds, view, wide)).toBe(true)
    expect(visiblePlacement({ x: 900, z: 100 }, bounds, view, wide)).toBe(false)
    const tall = mapFit(bounds, 500, 500)
    expect(visiblePlacement({ x: 200, z: 0 }, bounds, view, tall)).toBe(true)
    expect(visiblePlacement({ x: 200, z: 400 }, bounds, view, tall)).toBe(true)
    expect(visiblePlacement({ x: 200, z: 500 }, bounds, view, tall)).toBe(false)
  })

  it('hit-tests fixed-screen-size markers and picks the topmost overlap', () => {
    const top = { ...placement, key: '2' }
    expect(placementAt([placement, top], bounds, view, 200, 100)).toBe(top)
    expect(placementAt([placement], bounds, view, 210, 100)).toBeNull()
    expect(
      placementAt([placement], bounds, { ...view, zoom: 1 }, 210, 100),
    ).toBe(placement)
    expect(markerSize(bounds)).toBe(27)
  })

  it('supports relative plots with nonzero origins', () => {
    const relative = { ...bounds, x: 500, y: 1000 }
    expect(
      visiblePlacement({ ...placement, x: 510, z: 1010 }, relative, {
        x: 500,
        y: 1000,
        zoom: 1,
      }),
    ).toBe(true)
  })
})
