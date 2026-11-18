import Supercluster from 'supercluster'
import { mapFit, type MapBounds, type Placement, type PlacementGroup } from './placement-scene'

// Use Supercluster's public geographic API with an inverse-Mercator mapping.
// This makes its projected coordinates linear in the game's planar X/Z space.
export function createPlacementIndex(placements: Placement[], bounds: MapBounds) {
  const extent = Math.max(bounds.width, bounds.height, 1)
  const index = new Supercluster<{ index: number; cluster?: false }>({
    radius: 40,
    extent: 512,
    maxZoom: 16,
  }).load(placements.map((placement, index) => ({
    type: 'Feature' as const,
    properties: { index },
    geometry: {
      type: 'Point' as const,
      coordinates: [
        (placement.x - bounds.x) / extent * 360 - 180,
        Math.atan(Math.sinh(Math.PI * (1 - 2 * (placement.z - bounds.y) / extent))) * 180 / Math.PI,
      ],
    },
  })))
  const levels = new Map<number, Placement[]>()
  return {
    atZoom(level: number) {
      const cached = levels.get(level)
      if (cached) return cached
      const result = index.getClusters([-180, -90, 180, 90], level).map((feature) => {
        const props = feature.properties
        if (!props.cluster) return placements[props.index]
        const members = index.getLeaves(props.cluster_id, Infinity)
          .map((leaf) => placements[leaf.properties.index])
          .sort((a, b) => (a.seconds ?? 0) - (b.seconds ?? 0))
        const group: PlacementGroup = {
          members,
          times: new Float64Array(members.length),
          x: new Float64Array(members.length + 1),
          z: new Float64Array(members.length + 1),
          firstKnown: members.findIndex((member) => member.seconds != null),
          lastKnown: new Int32Array(members.length + 1).fill(-1),
        }
        for (const [index, member] of members.entries()) {
          group.times[index] = member.seconds ?? 0
          group.x[index + 1] = group.x[index] + member.x
          group.z[index + 1] = group.z[index] + member.z
          group.lastKnown[index + 1] = member.seconds == null
            ? group.lastKnown[index]
            : index
        }
        return {
          key: `cluster:${level}:${props.cluster_id}`,
          x: group.x[members.length] / members.length,
          z: group.z[members.length] / members.length,
          color: '#75bbf7',
          icon: members[0].icon,
          label: `${members.length} nearby build records`,
          description: 'Zoom in or use the build-order list for individual records.',
          group,
        }
      })
      levels.set(level, result)
      return result
    },
  }
}

export function placementClusterZoom(
  bounds: MapBounds,
  zoom: number,
  width: number,
  height: number,
) {
  const scale = mapFit(bounds, width, height).scale
  return Math.max(0, Math.min(16, Math.floor(Math.log2(
    Math.max(bounds.width, bounds.height) * scale * zoom / 512,
  ))))
}

// A cluster is indexed once. A time preview uses a binary search and prefix
// sums, not a new spatial index or a scan of all of its records.
export function placementAtTime(placement: Placement, cutoff: number) {
  const group = placement.group
  if (!group) {
    if ((placement.seconds ?? 0) > cutoff) return null
    return {
      x: placement.x, z: placement.z, count: 1,
      first: placement.seconds ?? null,
      last: placement.seconds ?? null,
      single: placement,
    }
  }
  let low = 0
  let high = group.times.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (group.times[middle] <= cutoff) low = middle + 1
    else high = middle
  }
  if (!low) return null
  const first = group.firstKnown >= 0 && group.firstKnown < low
    ? group.members[group.firstKnown].seconds ?? null
    : null
  const lastIndex = group.lastKnown[low]
  return {
    x: group.x[low] / low,
    z: group.z[low] / low,
    count: low,
    first,
    last: lastIndex >= 0 ? group.members[lastIndex].seconds ?? null : null,
    single: low === 1 ? group.members[0] : null,
  }
}
