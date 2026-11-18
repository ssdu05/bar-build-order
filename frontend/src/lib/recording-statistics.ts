import { eventSeconds, internalName, numeric, resolvedName, type BuildRow } from './recording'
import type { Recording } from './schemas'
import type { RecordingStatistics, StatisticKey } from './recording-statistics-schema'

export type StatisticValues = Partial<Record<StatisticKey, number | null>>
export type StatisticsTeam = RecordingStatistics['teams'][number]

function simulationSeconds(row: BuildRow, kind: 'start' | 'finish' | 'removed', fps = 30) {
  const frame = numeric(row[`${kind}_frame`])
  return frame === null ? eventSeconds(row, kind) : frame / fps
}

// No interpolation and, importantly, no use of a future or stale snapshot.
export function sampleAt(stats: RecordingStatistics, team: StatisticsTeam, seconds: number) {
  const frame = seconds * stats.game_speed
  if (frame < stats.started_frame - 1e-6 || frame > stats.export_frame + 1e-6) return null
  let low = 0
  let high = team.samples.length
  while (low < high) {
    const mid = (low + high) >>> 1
    if (team.samples[mid].frame <= frame + 1e-6) low = mid + 1
    else high = mid
  }
  const sample = team.samples[low - 1]
  if (!sample || frame - sample.frame > stats.sample_period_frames + 1e-6) return null
  return {
    frame: sample.frame,
    values: Object.fromEntries(stats.metrics.map((key, i) => [key, sample.values[i]])) as StatisticValues,
  }
}

export function sumStatistic(values: StatisticValues[], key: StatisticKey) {
  if (!values.length || values.some((v) => v[key] == null)) return null
  return values.reduce((total, v) => total + v[key]!, 0)
}

export function existingAt(row: BuildRow, seconds: number, fps = 30) {
  const start = simulationSeconds(row, 'start', fps)
  const removed = simulationSeconds(row, 'removed', fps)
  return !unknownLifetime(row, seconds, fps) &&
    start !== null && start <= seconds && (removed === null || removed > seconds)
}

export function unknownLifetime(row: BuildRow, seconds: number, fps = 30) {
  const start = simulationSeconds(row, 'start', fps)
  if (start === null) return true
  return start <= seconds && ['finished_then_removed', 'removed_before_completion'].includes(row.status) &&
    simulationSeconds(row, 'removed', fps) === null
}

export function existingCounts(rows: BuildRow[], recording: Recording, seconds: number) {
  const groups = new Map<string, {
    name: string; internalName: string; player: string; kind: string
    completed: number; constructing: number; unknown: number
  }>()
  for (const row of rows) {
    if (!existingAt(row, seconds, recording.statistics?.game_speed)) continue
    const name = resolvedName(row, recording)
    const key = JSON.stringify([row.team_id, row.player, row.unit_def_id || row.unit_name || name, row.unit_kind])
    let group = groups.get(key)
    if (!group) {
      group = { name, internalName: internalName(row, recording), player: row.player, kind: row.unit_kind, completed: 0, constructing: 0, unknown: 0 }
      groups.set(key, group)
    }
    if (!group.internalName) group.internalName = internalName(row, recording)
    const finish = simulationSeconds(row, 'finish', recording.statistics?.game_speed)
    if (finish !== null && finish <= seconds) group.completed++
    else if (finish === null && ['finished', 'finished_then_removed'].includes(row.status)) group.unknown++
    else group.constructing++
  }
  return [...groups.values()].sort((a, b) => a.player.localeCompare(b.player) || a.name.localeCompare(b.name))
}

// Optional version-matched costs support value estimates even without BAR's newer API.
// Attribution stays with the original builder because old CSVs lack transfer timestamps.
export function recordedValues(rows: BuildRow[], recording: Recording, seconds: number): StatisticValues {
  if (!recording.unit_map) return {}
  if (rows.some((row) => unknownLifetime(row, seconds, recording.statistics?.game_speed))) return {}
  const result: StatisticValues = {
    unitValue: 0, valueArmy: 0, valueAir: 0, valueSea: 0, valueDefense: 0,
    valueStrategic: 0, valueFactories: 0, valueBuilders: 0, valueEconomy: 0, valueUtility: 0,
  }
  const keys = {
    army: 'valueArmy', air: 'valueAir', sea: 'valueSea', defense: 'valueDefense',
    strategic: 'valueStrategic', factories: 'valueFactories', builders: 'valueBuilders',
    economy: 'valueEconomy', utility: 'valueUtility',
  } as const
  // Do not claim a zero army value when only old name-only definitions were imported.
  if (!Object.values(recording.unit_map.units).some((d) => d.metal_cost != null && d.energy_cost != null && d.category)) return {}
  for (const row of rows) {
    if (!existingAt(row, seconds, recording.statistics?.game_speed)) continue
    const finish = simulationSeconds(row, 'finish', recording.statistics?.game_speed)
    if (finish === null) {
      if (['finished', 'finished_then_removed'].includes(row.status)) return {}
      continue
    }
    if (finish > seconds) continue
    const def = recording.unit_map.units[row.unit_def_id]
    if (!def || def.metal_cost == null || def.energy_cost == null || !def.category) return {}
    const value = def.metal_cost + def.energy_cost / 60
    result.unitValue! += value
    result[keys[def.category]]! += value
  }
  return result
}

export function statisticsMaximum(recording: Recording, rows: BuildRow[]) {
  const fps = recording.statistics?.game_speed ?? 30
  return Math.max(
    recording.statistics ? recording.statistics.export_frame / recording.statistics.game_speed : 0,
    recording.summary?.export_frame ? recording.summary.export_frame / (recording.statistics?.game_speed ?? 30) : 0,
    rows.reduce((max, row) => Math.max(max, simulationSeconds(row, 'start', fps) ?? 0,
      simulationSeconds(row, 'finish', fps) ?? 0, simulationSeconds(row, 'removed', fps) ?? 0), 0),
  )
}

export function recordingTeams(rows: BuildRow[], recording: Recording) {
  const teams = new Map<string, { id: string; player: string; ally: number | null; source?: StatisticsTeam }>()
  for (const row of rows) {
    if (!teams.has(row.team_id)) teams.set(row.team_id, { id: row.team_id, player: row.player, ally: null })
  }
  for (const team of recording.statistics?.teams ?? []) {
    teams.set(String(team.team_id), {
      id: String(team.team_id), player: team.player, ally: team.ally_team_id, source: team,
    })
  }
  return [...teams.values()].sort((a, b) => (numeric(a.id) ?? 0) - (numeric(b.id) ?? 0))
}
