import { statisticGroups } from './recording-statistic-metrics'
import type { RecordingStatistics, StatisticKey } from './recording-statistics-schema'

export type GraphMetric = {
  id: string
  label: string
  keys: StatisticKey[]
  calculate?: (values: number[]) => number | null
}

export const graphMetrics: GraphMetric[] = [
  ...statisticGroups.flatMap((group) => group.metrics.map(([key, label]) => ({
    id: key,
    label: ({
      metalIncome: 'Metal production /s (including reclaim)',
      energyIncome: 'Energy production /s (including reclaim)',
      metalProduced: 'Total metal produced (including reclaim)',
      energyProduced: 'Total energy produced (including reclaim)',
    } as Partial<Record<StatisticKey, string>>)[key] ?? label,
    keys: [key],
  }))),
  { id: 'metalGeneration', label: 'Metal production /s (excluding reclaim)',
    keys: ['metalIncome', 'metalReclaimIncome'], calculate: ([total, reclaim]) => Math.max(0, total - reclaim) },
  { id: 'energyGeneration', label: 'Energy production /s (excluding reclaim)',
    keys: ['energyIncome', 'energyReclaimIncome'], calculate: ([total, reclaim]) => Math.max(0, total - reclaim) },
  { id: 'metalGenerated', label: 'Total metal generated (excluding reclaim)',
    keys: ['metalProduced', 'metalReclaimed'], calculate: ([total, reclaim]) => Math.max(0, total - reclaim) },
  { id: 'energyGenerated', label: 'Total energy generated (excluding reclaim)',
    keys: ['energyProduced', 'energyReclaimed'], calculate: ([total, reclaim]) => Math.max(0, total - reclaim) },
  { id: 'mobileArmy', label: 'Mobile army value (ground + air + navy)',
    keys: ['valueArmy', 'valueAir', 'valueSea'], calculate: (values) => values.reduce((sum, n) => sum + n, 0) },
  { id: 'buildPowerUse', label: 'Build-power utilisation (%)',
    keys: ['buildPowerActive', 'buildPower'], calculate: ([active, total]) => total > 0 ? active / total * 100 : null },
]

export type GraphPoint = { x: number; y: number | null }

// Deliberately takes no timeline, player selection, or construction filters.
export function recordingGraphSeries(stats: RecordingStatistics, metric: GraphMetric) {
  const indices = metric.keys.map((key) => stats.metrics.indexOf(key))
  return stats.teams.map((team) => {
    const points: GraphPoint[] = []
    let previousFrame: number | undefined
    let known = 0
    for (const sample of team.samples) {
      if (previousFrame !== undefined && sample.frame - previousFrame > stats.sample_period_frames) {
        points.push({ x: (previousFrame + stats.sample_period_frames) / stats.game_speed, y: null })
      }
      const values = indices.map((index) => index < 0 ? null : sample.values[index])
      const value = values.some((v) => v == null)
        ? null
        : metric.calculate ? metric.calculate(values as number[]) : values[0]
      const y = value != null && Number.isFinite(value) ? value : null
      if (y !== null) known++
      points.push({ x: sample.frame / stats.game_speed, y })
      previousFrame = sample.frame
    }
    return { team, points, known }
  })
}

export type GraphSeries = ReturnType<typeof recordingGraphSeries>[number]

export function groupAlliedGraphSeries(series: GraphSeries[]) {
  const groups = new Map<string, { id: string; label: string; series: GraphSeries[] }>()
  for (const entry of series) {
    const { team } = entry
    const id = team.ally_team_id === null ? `team:${team.team_id}` : `ally:${team.ally_team_id}`
    let group = groups.get(id)
    if (!group) {
      group = {
        id,
        label: team.ally_team_id === null ? team.player : `Allied side ${team.ally_team_id + 1}`,
        series: [],
      }
      groups.set(id, group)
    }
    group.series.push(entry)
  }
  return [...groups.values()]
}
