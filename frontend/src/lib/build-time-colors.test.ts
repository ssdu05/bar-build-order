import { describe, expect, it } from 'vitest'
import { csvFor } from '@/test/fixtures'
import { parseRecording } from './recording'
import {
  buildTimeColors,
  buildTimeScale,
  unknownBuildTimeColor,
} from './build-time-colors'

describe('build-time outline colors', () => {
  it('colors by elapsed creation time, independent of row order or player', () => {
    const rows = parseRecording(
      csvFor(
        { start_seconds: '0', player: 'Alice' },
        { start_seconds: '10', player: 'Bob' },
        { start_seconds: '20', player: 'Alice' },
      ),
    )
    const scale = buildTimeScale([...rows].reverse())
    expect(scale.first).toBe(0)
    expect(scale.last).toBe(20)
    expect([...rows.map((row) => scale.colors.get(row.key))]).toEqual(
      buildTimeColors,
    )
    const uneven = buildTimeScale([
      rows[0],
      { ...rows[1], start_seconds: '2' },
      rows[2],
    ])
    expect(uneven.colors.get(rows[1].key)).not.toBe(buildTimeColors[1])
  })

  it('rescales to the selected and filtered subset', () => {
    const rows = parseRecording(
      csvFor(
        { start_seconds: '0' },
        { start_seconds: '10' },
        { start_seconds: '20' },
      ),
    )
    const scale = buildTimeScale(rows.slice(1))
    expect(scale.first).toBe(10)
    expect(scale.colors.get(rows[1].key)).toBe(buildTimeColors[0])
    expect(scale.colors.get(rows[2].key)).toBe(buildTimeColors[2])
  })

  it('uses frames and clock strings when seconds are unavailable', () => {
    const rows = parseRecording(
      csvFor(
        { start_frame: '30' },
        { start_time: '00:02' },
        { start_seconds: '3', finish_seconds: '100' },
      ),
    )
    expect([...buildTimeScale(rows).colors.values()]).toEqual(buildTimeColors)
  })

  it('uses a neutral midpoint for simultaneous or single timed placements', () => {
    const rows = parseRecording(
      csvFor({ start_seconds: '5' }, { start_seconds: '5' }),
    )
    expect([...buildTimeScale(rows).colors.values()]).toEqual([
      buildTimeColors[1],
      buildTimeColors[1],
    ])
    expect(buildTimeScale(rows.slice(0, 1)).colors.get(rows[0].key)).toBe(
      buildTimeColors[1],
    )
  })

  it('shows unknown timestamps separately without treating them as zero', () => {
    const rows = parseRecording(
      csvFor({ start_seconds: '0' }, {}, { start_time: 'invalid' }),
    )
    const scale = buildTimeScale(rows)
    expect(scale.first).toBe(0)
    expect(scale.last).toBe(0)
    expect(scale.unknown).toBe(2)
    expect(scale.colors.get(rows[1].key)).toBe(unknownBuildTimeColor)
    expect(scale.colors.get(rows[2].key)).toBe(unknownBuildTimeColor)
  })

  it('handles empty and entirely unknown selections', () => {
    expect(buildTimeScale([])).toEqual({
      first: null,
      last: null,
      unknown: 0,
      colors: new Map(),
    })
    const rows = parseRecording(csvFor({}))
    expect(buildTimeScale(rows)).toEqual({
      first: null,
      last: null,
      unknown: 1,
      colors: new Map([[rows[0].key, unknownBuildTimeColor]]),
    })
  })
})
