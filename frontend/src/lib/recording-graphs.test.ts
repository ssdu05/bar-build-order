import { describe, expect, it } from 'vitest'
import { statisticsFixture } from '@/test/statistics-fixture'
import { statisticKeys } from './recording-statistics-schema'
import { graphMetrics, groupAlliedGraphSeries, recordingGraphSeries } from './recording-graphs'

const metric = (id: string) => graphMetrics.find((m) => m.id === id)!

describe('full recording graph data', () => {
  it('includes every team and the full recording, without a timestamp cutoff', () => {
    const stats = statisticsFixture()
    const series = recordingGraphSeries(stats, metric('metalIncome'))
    expect(series.map((s) => s.team.player)).toEqual(['Alice', 'Bob'])
    expect(series[0].points[0]).toEqual({ x: 0, y: 1 })
    expect(series[0].points.at(-1)).toEqual({ x: 20, y: 40 })
    expect(series[1].points.at(-1)).toEqual({ x: 10, y: 8 })
    expect(series[0].known).toBe(4)
    expect(stats.teams[0].samples).toHaveLength(4)
  })

  it('keeps missing metrics and missed sample intervals as gaps, not zeroes', () => {
    const stats = statisticsFixture()
    const metal = recordingGraphSeries(stats, metric('metalIncome'))
    expect(metal[0].points).toContainEqual({ x: 15, y: null })
    const energy = recordingGraphSeries(stats, metric('energyIncome'))
    expect(energy[0].points[0].y).toBeNull()
    expect(energy[1].known).toBe(0)
    expect(energy[1].points.every((p) => p.y === null)).toBe(true)
    const absent = recordingGraphSeries(stats, metric('energyProduced'))
    expect(absent.every((s) => s.known === 0)).toBe(true)
  })

  it('distinguishes production rates, cumulative totals, and production excluding reclaim', () => {
    const stats = statisticsFixture()
    expect(recordingGraphSeries(stats, metric('metalProduced'))[0].points.at(-1)?.y).toBe(400)
    expect(recordingGraphSeries(stats, metric('metalGeneration'))[0].points.at(-1)?.y).toBe(38)
    expect(recordingGraphSeries(stats, metric('mobileArmy'))[0].points.at(-1)?.y).toBe(850)
    expect(recordingGraphSeries(stats, metric('metalGenerated'))[0].known).toBe(0)
  })

  it('offers every recorded statistic without duplicate selector labels or IDs', () => {
    expect(new Set(graphMetrics.map((m) => m.id)).size).toBe(graphMetrics.length)
    expect(new Set(graphMetrics.map((m) => m.label)).size).toBe(graphMetrics.length)
    expect(statisticKeys.every((key) => graphMetrics.some((m) => m.id === key))).toBe(true)
  })

  it('groups allied teams without summing or changing their histories', () => {
    const stats = statisticsFixture()
    stats.teams.push(
      { ...stats.teams[0], team_id: 2, ally_team_id: 1, player: 'Charlie' },
      { ...stats.teams[1], team_id: 3, ally_team_id: null, player: 'Dana' },
      { ...stats.teams[1], team_id: 4, ally_team_id: null, player: 'Eve' },
    )
    const series = recordingGraphSeries(stats, metric('metalIncome'))
    const groups = groupAlliedGraphSeries(series)
    expect(groups.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: 'ally:0', label: 'Allied side 1' },
      { id: 'ally:1', label: 'Allied side 2' },
      { id: 'team:3', label: 'Dana' },
      { id: 'team:4', label: 'Eve' },
    ])
    expect(groups[0].series).toEqual(series.slice(0, 2))
    expect(groups[0].series[0]).toBe(series[0])
    expect(groups[0].series[1]).toBe(series[1])
    expect(groupAlliedGraphSeries([])).toEqual([])
  })
})
