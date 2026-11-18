import { z } from 'zod'

// Shared contract with the recorder and backend/app/statistics.py.
export const statisticKeys = [
  'metalIncome', 'metalExpense', 'metalCurrent', 'metalStorage',
  'energyIncome', 'energyExpense', 'energyCurrent', 'energyStorage',
  'metalProduced', 'metalUsed', 'metalExcess', 'metalSent', 'metalReceived',
  'energyProduced', 'energyUsed', 'energyExcess', 'energySent', 'energyReceived',
  'metalReclaimed', 'energyReclaimed', 'metalReclaimIncome', 'energyReclaimIncome',
  'damageDealt', 'damageReceived', 'unitsProduced', 'unitsKilled', 'unitsDied',
  'unitValue', 'valueArmy', 'valueAir', 'valueSea', 'valueDefense',
  'valueStrategic', 'valueFactories', 'valueBuilders', 'valueEconomy', 'valueUtility',
  'killedValue', 'lostValue', 'buildPower', 'buildPowerActive', 'buildPowerIdle',
  'convUse', 'convCapacity', 'idleCons', 'cons', 'idleLabs', 'labs',
  'metalSpots', 'geoSpots', 'incomeMex', 'incomeConverters',
  'incomeWind', 'incomeSolar', 'incomeTidal', 'incomeGeo', 'incomeFusion',
] as const
export type StatisticKey = (typeof statisticKeys)[number]
const frame = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
export const statisticsSchema = z.strictObject({
  format: z.literal('realbo_statistics'),
  schema_version: z.literal(1),
  replay_file: z.string().max(1024),
  map: z.string().max(1024),
  game_version: z.string().max(1024),
  game_speed: z.number().positive().max(1000),
  sample_period_frames: frame.refine((n) => n > 0),
  started_frame: frame,
  export_frame: frame,
  game_over: z.boolean(),
  full_replay_captured: z.boolean(),
  truncated: z.boolean(),
  metrics: z.array(z.enum(statisticKeys)).min(1).max(statisticKeys.length),
  teams: z.array(z.strictObject({
    team_id: frame,
    ally_team_id: frame.nullable(),
    player: z.string().min(1).max(1024),
    samples: z.array(z.strictObject({
      frame,
      values: z.array(z.number().finite().nullable()).max(statisticKeys.length),
    })).max(100_000),
  })).max(256),
}).superRefine((stats, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: 'custom', message })
  if (stats.started_frame > stats.export_frame) fail('Statistics frame range is invalid.')
  if (new Set(stats.metrics).size !== stats.metrics.length) fail('Duplicate statistics metrics.')
  if (new Set(stats.teams.map((t) => t.team_id)).size !== stats.teams.length) fail('Duplicate statistics teams.')
  let count = 0
  for (const team of stats.teams) {
    let previous = -1
    for (const sample of team.samples) {
      count++
      if (sample.frame <= previous || sample.frame < stats.started_frame || sample.frame > stats.export_frame)
        fail('Statistics samples must be ordered, unique, and within the capture.')
      if (sample.values.length !== stats.metrics.length) fail('Statistics sample width does not match metrics.')
      previous = sample.frame
    }
  }
  if (count > 100_000) fail('Too many statistics samples (max 100,000).')
})
export type RecordingStatistics = z.infer<typeof statisticsSchema>
