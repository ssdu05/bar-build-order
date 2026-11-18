import { useMemo, useState } from 'react'
import type { Recording } from '@/lib/schemas'
import { type BuildRow, eventSeconds } from '@/lib/recording'
import { useRecordingTime, type RecordingTimeline } from '@/lib/recording-timeline'
import {
  existingCounts, recordedValues, recordingTeams, sampleAt, sumStatistic,
  unknownLifetime,
  type StatisticValues,
} from '@/lib/recording-statistics'
import type { StatisticKey } from '@/lib/recording-statistics-schema'
import { timeLabel } from '@/lib/replays'
import { statisticGroups as groups } from '@/lib/recording-statistic-metrics'
import { UnitIcon } from './ReplayMap'
import { Button } from './ui/button'
import { Combobox } from './ui/combobox'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'

const format = (value: number | null | undefined) =>
  value == null ? 'Not recorded' : value.toLocaleString(undefined, { maximumFractionDigits: 1 })

export function RecordingStatistics({
  rows, countRows, recording, timeline, player, onPlayerChange, version = 0,
}: {
  rows: BuildRow[]
  countRows: BuildRow[]
  recording: Recording
  timeline: RecordingTimeline
  player: string
  onPlayerChange: (player: string) => void
  version?: number
}) {
  const cutoff = useRecordingTime(timeline)
  const [allied, setAllied] = useState(false)
  const teams = useMemo(() => recordingTeams(rows, recording), [rows, recording])
  const stats = recording.statistics
  const teamRows = useMemo(() => {
    const result = new Map<string, BuildRow[]>()
    for (const row of rows) {
      const builds = result.get(row.team_id)
      if (builds) builds.push(row)
      else result.set(row.team_id, [row])
    }
    return result
  }, [rows])
  const counts = useMemo(() => existingCounts(countRows, recording, cutoff), [countRows, recording, cutoff])
  const unknownLifetimes = countRows.filter((row) => unknownLifetime(row, cutoff, stats?.game_speed)).length
  const scopes = useMemo(() => {
    const result = new Map<string, {
      name: string; values: StatisticValues[]; frames: number[]; fallback: boolean
      members: typeof teams
    }>()
    for (const team of teams) {
      if (player && team.player !== player && !rows.some((r) => r.team_id === team.id && r.player === player)) continue
      const key = allied && team.ally !== null ? `ally:${team.ally}` : `team:${team.id}`
      let scope = result.get(key)
      if (!scope) {
        scope = { name: allied && team.ally !== null ? `Allied side ${team.ally + 1}` : team.player,
          values: [], frames: [], fallback: false, members: [] }
        result.set(key, scope)
      }
      const sample = stats && team.source ? sampleAt(stats, team.source, cutoff) : null
      const values = { ...sample?.values }
      const fallback = !stats || sample
        ? recordedValues(teamRows.get(team.id) ?? [], recording, cutoff) : {}
      for (const [key, value] of Object.entries(fallback)) {
        if (values[key as StatisticKey] == null) {
          values[key as StatisticKey] = value
          scope.fallback = true
        }
      }
      scope.members.push(team)
      scope.values.push(values)
      if (sample) scope.frames.push(sample.frame)
    }
    return [...result.values()]
  }, [teams, player, allied, rows, stats, recording, cutoff, teamRows])
  const sum = (scope: (typeof scopes)[number], key: StatisticKey) => sumStatistic(scope.values, key)
  const army = (scope: (typeof scopes)[number]) => {
    const parts = (['valueArmy', 'valueAir', 'valueSea'] as const).map((key) => sum(scope, key))
    return parts.some((v) => v === null) ? null : parts.reduce<number>((n, v) => n + v!, 0)
  }
  return (
    <section id="recording-statistics" aria-label="Recording statistics" className="panel space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h4 className="font-semibold">Statistics at {timeLabel(cutoff)}</h4>
          <p className="muted">Existing at this time, not cumulative build starts.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Combobox label="Statistics player" value={player}
            options={[...new Set(teams.map((t) => t.player))]}
            onChange={onPlayerChange} />
          <Button size="sm" variant={allied ? 'default' : 'outline'}
            disabled={!teams.some((t) => t.ally !== null)}
            aria-pressed={allied} onClick={() => setAllied(!allied)}>
            Group allied players
          </Button>
        </div>
      </div>
      <p className="muted">
        Counts below follow player, name and building/unit filters, but not the export-time construction-status filter or map selection.
        Economy and force-value statistics cover each whole player army, regardless of unit filters.
        Counts and cost-based estimates use original build ownership; CSVs do not contain transfer times.
        Co-op players sharing one army share its statistics.
        Full capture and observer visibility are required for complete results.
      </p>
      <p className="text-sm font-medium" aria-label="Existing counts">
        {counts.filter((c) => c.kind === 'building').reduce((n, c) => n + c.completed, 0)} completed buildings ·{' '}
        {counts.filter((c) => c.kind === 'unit').reduce((n, c) => n + c.completed, 0)} completed units ·{' '}
        {counts.reduce((n, c) => n + c.constructing, 0)} under construction ·{' '}
        {counts.reduce((n, c) => n + c.unknown, 0)} completion time unknown
      </p>
      {unknownLifetimes > 0 && <p className="muted">{unknownLifetimes} matching records have missing creation/removal times and are excluded from existing counts.</p>}
      {!stats ? (
        <p role="status" className="text-sm text-primary">
          Economy and combat history: Not recorded. Replay with the updated widget and import _statistics.json.
          Import its _unit_defs.json for cost-based force-value estimates.
        </p>
      ) : (
        <p className="muted">
          {recording.statistics_filename} · Snapshots every {stats.sample_period_frames / stats.game_speed}s;
          the latest snapshot at or before the selected time is used, never a future sample.
          Income includes reclaim as reported by the engine; production totals follow BAR’s definitions.
          Engine combat totals may update less frequently.
          {(!stats.full_replay_captured || !stats.game_over) && ' Warning: partial capture; totals and counts may be incomplete.'}
          {stats.truncated && ' Warning: statistics size limit reached; later snapshots are missing.'}
        </p>
      )}
      {scopes.some((s) => s.fallback) && (
        <p className="muted">Some force values are cost-based estimates from completed surviving records, attributed to the original player.</p>
      )}
      <Table aria-label="Player statistics">
        <TableHeader><TableRow><TableHead>Statistic</TableHead>
          {scopes.map((scope, i) => <TableHead key={i} title={scope.members.map((t) => t.player).join(', ')}>{scope.name}</TableHead>)}
        </TableRow></TableHeader>
        <TableBody>
          <TableRow><TableCell>Snapshot time</TableCell>{scopes.map((scope, i) => (
            <TableCell key={i}>{scope.frames.length === scope.members.length && stats
              ? timeLabel(Math.min(...scope.frames) / stats.game_speed) : 'Not recorded'}</TableCell>
          ))}</TableRow>
          <TableRow><TableCell className="font-semibold">Mobile army value (ground + air + navy)</TableCell>
            {scopes.map((scope, i) => <TableCell key={i}>{format(army(scope))}</TableCell>)}</TableRow>
          {([
            ['Metal production /s (excluding reclaim)', 'metalIncome', 'metalReclaimIncome'],
            ['Energy production /s (excluding reclaim)', 'energyIncome', 'energyReclaimIncome'],
            ['Metal generated total (excluding reclaim)', 'metalProduced', 'metalReclaimed'],
            ['Energy generated total (excluding reclaim)', 'energyProduced', 'energyReclaimed'],
          ] as const).map(([label, totalKey, reclaimKey]) => <TableRow key={label}>
            <TableCell>{label}</TableCell>
            {scopes.map((scope, i) => {
              const total = sum(scope, totalKey)
              const reclaimed = sum(scope, reclaimKey)
              return <TableCell key={i}>{format(total == null || reclaimed == null ? null : Math.max(0, total - reclaimed))}</TableCell>
            })}
          </TableRow>)}
          {groups.map((group) => (
            <TableRow key={group.label}>
              <TableCell>{group.label}</TableCell>
              {scopes.map((scope, i) => <TableCell key={i}>
                <details><summary className="cursor-pointer">Show {group.label.toLowerCase()}</summary>
                  <dl className="mt-2 space-y-1">{group.metrics.map(([key, label]) => (
                    <div key={key} className="flex justify-between gap-4"><dt>{label}</dt><dd className="tabular-nums">{format(sum(scope, key))}</dd></div>
                  ))}</dl>
                </details>
              </TableCell>)}
            </TableRow>
          ))}
          <TableRow><TableCell>Value destroyed / lost</TableCell>{scopes.map((scope, i) => {
            const killed = sum(scope, 'killedValue')
            const lost = sum(scope, 'lostValue')
            return <TableCell key={i}>{killed == null || lost == null ? 'Not recorded' : lost === 0 ? '— (no losses)' : `${format(killed / lost)}×`}</TableCell>
          })}</TableRow>
          <TableRow><TableCell>Build-power utilisation</TableCell>{scopes.map((scope, i) => {
            const active = sum(scope, 'buildPowerActive')
            const available = sum(scope, 'buildPower')
            return <TableCell key={i}>{active == null || available == null ? 'Not recorded' : available === 0 ? '— (no build power)' : `${format(active / available * 100)}%`}</TableCell>
          })}</TableRow>
        </TableBody>
      </Table>
      <p className="muted">Force value = metal cost + energy cost ÷ 60, not combat strength; damage does not reduce replacement cost. Mobile army excludes constructors, static defences and strategic weapons.</p>
      <details>
        <summary className="cursor-pointer text-sm font-semibold">Existing buildings / units by type ({counts.reduce((n, c) => n + c.completed + c.constructing + c.unknown, 0)})</summary>
        <Table aria-label="Existing buildings and units">
          <TableHeader><TableRow>{['Original player', 'Type', 'Kind', 'Completed', 'Under construction', 'Completion time unknown'].map((label) => <TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader>
          <TableBody>{counts.slice(0, 200).map((c, i) => <TableRow key={i}>
            <TableCell>{c.player}</TableCell>
            <TableCell>
              <span className="flex items-center gap-2">
                <UnitIcon name={c.internalName} version={version} />
                {c.name}
              </span>
            </TableCell>
            <TableCell>{c.kind}</TableCell>
            <TableCell>{c.completed}</TableCell><TableCell>{c.constructing}</TableCell><TableCell>{c.unknown}</TableCell>
          </TableRow>)}</TableBody>
        </Table>
        {counts.length > 200 && <p className="muted">Showing the first 200 player/type combinations. Narrow the player or name filters to see others; the total includes all matches.</p>}
        {!counts.length && <p className="muted">No matching buildings or units exist at this time.</p>}
      </details>
      <details>
        <summary className="cursor-pointer text-sm font-semibold">Opening milestones</summary>
        {teams.filter((t) => !player || t.player === player).map((team) => {
          const first = rows.filter((r) => r.team_id === team.id && recording.unit_map?.units[r.unit_def_id]?.is_factory)
            .map((r) => eventSeconds(r, 'finish')).filter((n): n is number => n !== null && n <= cutoff).sort((a, b) => a - b)[0]
          return <p key={team.id} className="muted">{team.player}: first factory completed {first == null ? '— (not observed by this time)' : timeLabel(first)}</p>
        })}
      </details>
    </section>
  )
}
