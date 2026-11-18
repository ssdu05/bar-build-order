import { describe, expect, it } from 'vitest'
import { createPlacementIndex, placementAtTime, placementClusterZoom } from './placement-clusters'
import type { Placement } from './placement-scene'

const bounds = { x: 0, y: 0, width: 1000, height: 500 }
const point: Placement = {
  key: '1', x: 200, z: 100, color: '#fff', icon: '/unit.png',
  label: 'Unit', description: 'Details', seconds: 1,
}
const countAt = (points: Placement[], cutoff: number) =>
  points.reduce((count, point) => count + (placementAtTime(point, cutoff)?.count ?? 0), 0)

describe('placement clustering', () => {
  it('clusters 8,000 records without dropping records or rebuilding when time changes', () => {
    const points = Array.from({ length: 8000 }, (_, index) => ({
      ...point, key: String(index), seconds: index,
      x: 50 + index * 137 % 900, z: 50 + index * 293 % 400,
    }))
    const index = createPlacementIndex(points, bounds)
    const clusters = index.atZoom(0)
    expect(clusters.length).toBeLessThan(200)
    for (const time of [0, 100, 4000, 7999])
      expect(countAt(clusters, time)).toBe(time + 1)
    expect(index.atZoom(0)).toBe(clusters)
  })

  it('reports the active centroid and time range, revealing a unit icon when only one record matches', () => {
    const points = [
      { ...point, key: 'a', seconds: 5, x: 210 },
      { ...point, key: 'b', seconds: 1, x: 200 },
      { ...point, key: 'c', seconds: 10, x: 220 },
    ]
    const [cluster] = createPlacementIndex(points, bounds).atZoom(0)
    expect(placementAtTime(cluster, 0)).toBeNull()
    expect(placementAtTime(cluster, 1)).toMatchObject({
      count: 1, x: 200, z: 100, first: 1, last: 1, single: points[1],
    })
    expect(placementAtTime(cluster, 5)).toMatchObject({
      count: 2, x: 205, first: 1, last: 5, single: null,
    })
    expect(placementAtTime(cluster, 10)).toMatchObject({
      count: 3, x: 210, first: 1, last: 10,
    })
  })

  it('keeps unknown times at cutoff zero without treating them as known timestamps', () => {
    const [cluster] = createPlacementIndex([
      { ...point, key: 'unknown', seconds: null },
      { ...point, seconds: 5 },
    ], bounds).atZoom(0)
    expect(placementAtTime(cluster, 0)).toMatchObject({
      count: 1, first: null, last: null,
    })
    expect(placementAtTime(cluster, 5)).toMatchObject({
      count: 2, first: 5, last: 5,
    })
  })

  it('reveals spatially separated records on zoom and supports rectangular relative bounds', () => {
    const relative = { x: 1000, y: 2000, width: 1000, height: 200 }
    const points = [
      { ...point, x: 1000, z: 2000 },
      { ...point, key: '2', x: 1030, z: 2000 },
      { ...point, key: '3', x: 2000, z: 2200 },
    ]
    const index = createPlacementIndex(points, relative)
    const wide = index.atZoom(0)
    const close = index.atZoom(5)
    expect(wide.length).toBeLessThan(close.length)
    expect(close).toHaveLength(3)
    expect(countAt(wide, Infinity)).toBe(3)
    expect(countAt(close, Infinity)).toBe(3)
    expect(placementClusterZoom(relative, 1, 512, 512)).toBe(0)
    expect(placementClusterZoom(relative, 16, 512, 512)).toBe(4)
  })
})
