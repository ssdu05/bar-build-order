import { eventSeconds, type BuildRow } from './recording'

export const buildTimeColors = ['#3b82f6', '#2dd4bf', '#facc15'] as const
export const unknownBuildTimeColor = '#94a3b8'
export const buildTimeGradient = `linear-gradient(to right, ${buildTimeColors.join(', ')})`

function gradientColor(position: number) {
  const segment = position <= 0.5 ? 0 : 1
  const fraction = position * 2 - segment
  const start = Number.parseInt(buildTimeColors[segment].slice(1), 16)
  const end = Number.parseInt(buildTimeColors[segment + 1].slice(1), 16)
  const channels = [16, 8, 0].map((shift) => {
    const a = (start >> shift) & 255
    const b = (end >> shift) & 255
    return Math.round(a + (b - a) * fraction)
      .toString(16)
      .padStart(2, '0')
  })
  return `#${channels.join('')}`
}

export function buildTimeRange(times: Iterable<number | null>) {
  let first = Infinity,
    last = -Infinity,
    unknown = 0
  for (const seconds of times) {
    if (seconds === null) unknown++
    else {
      first = Math.min(first, seconds)
      last = Math.max(last, seconds)
    }
  }
  return {
    first: first === Infinity ? null : first,
    last: last === -Infinity ? null : last,
    unknown,
  }
}

export function buildTimeColor(
  seconds: number | null,
  first: number | null,
  last: number | null,
) {
  return seconds === null || first === null || last === null
    ? unknownBuildTimeColor
    : gradientColor(first === last ? 0.5 : (seconds - first) / (last - first))
}

// Use actual start timestamps, not list order or completion time. The caller
// supplies only placements matching the current selection and filters.
export function buildTimeScale(rows: BuildRow[]) {
  const times = rows.map((row) => ({
    key: row.key,
    seconds: eventSeconds(row),
  }))
  const range = buildTimeRange(times.map(({ seconds }) => seconds))
  const colors = new Map(
    times.map(({ key, seconds }) => [
      key,
      buildTimeColor(seconds, range.first, range.last),
    ]),
  )
  return {
    colors,
    ...range,
  }
}
