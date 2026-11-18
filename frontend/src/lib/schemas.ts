import { z } from 'zod'
import { statisticsSchema } from './recording-statistics-schema'

// Keep validation compatible with the production CSP; never probe eval/JIT.
z.config({ jitless: true })

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const metadata = {
  replay_file: z.string().max(1024),
  map: z.string().max(1024),
  game_version: z.string().max(1024),
}

export const summarySchema = z
  .strictObject({
    format: z.literal('realbo_summary'),
    schema_version: z.literal(1),
    ...metadata,
    export_time: z.string().max(1024),
    game_over: z.boolean(),
    full_replay_captured: z.boolean(),
    skipped_frames: z.boolean(),
    rewind_detected: z.boolean(),
    started_frame: count,
    export_frame: count,
    counts: z.strictObject({
      started: count,
      buildings: count,
      units: count,
      completed: count,
      removed_before_completion: count,
      unfinished: count,
    }),
  })
  .refine(
    ({ counts: c }) =>
      c.started === c.buildings + c.units &&
      c.started === c.completed + c.removed_before_completion + c.unfinished,
    'Summary counts do not add up.',
  )

export const unitMapSchema = z.strictObject({
  game: z.string(),
  ...metadata,
  units: z
    .record(
      z.string().regex(/^[1-9][0-9]{0,9}$/),
      z.strictObject({
        display_name: z.string().trim().min(1),
        internal_name: z.string(),
        is_building: z.boolean(),
         is_factory: z.boolean(),
        metal_cost: z.number().finite().nonnegative().nullish(),
        energy_cost: z.number().finite().nonnegative().nullish(),
        category: z.enum(['army', 'air', 'sea', 'defense', 'strategic', 'factories', 'builders', 'economy', 'utility']).nullish(),
      }),
    )
    .refine(
      (units) => Object.keys(units).length > 0,
      'No unit definitions found.',
    ),
})

export const recordingSchema = z.strictObject({
  csv: z.string(),
  filename: z.string().default('recording.csv'),
  unit_map: unitMapSchema.nullish(),
  unit_map_filename: z.string().default(''),
  summary: summarySchema.nullish(),
  summary_filename: z.string().default(''),
  statistics: statisticsSchema.nullish(),
  statistics_filename: z.string().default(''),
})

const playerSchema = z.looseObject({
  name: z.string().nullish(),
  teamId: z.union([z.string(), z.number()]).nullish(),
  faction: z.string().nullish(),
  skill: z.union([z.string(), z.number()]).nullish(),
  skillUncertainty: z.number().nullish(),
  startPos: z
    .looseObject({ x: z.number().nullish(), z: z.number().nullish() })
    .nullish(),
  rgbColor: z
    .looseObject({ r: z.number(), g: z.number(), b: z.number() })
    .nullish(),
})
export const replaySchema = z.looseObject({
  id: z.string().optional(),
  fileName: z.string().nullish(),
  gameVersion: z.string().nullish(),
  preset: z.string().nullish(),
  startTime: z.string().nullish(),
  durationMs: z.number().nullish(),
  gameEndedNormally: z.boolean().nullish(),
  Map: z
    .looseObject({
      fileName: z.string().nullish(),
      scriptName: z.string().nullish(),
      width: z.number().nullish(),
      height: z.number().nullish(),
    })
    .nullish(),
  gameSettings: z.looseObject({ ranked_game: z.unknown() }).nullish(),
  hostSettings: z.looseObject({ mapname: z.string().nullish() }).nullish(),
  AllyTeams: z
    .array(
      z.looseObject({
        Players: z.array(playerSchema).nullish(),
        winningTeam: z.boolean().nullish(),
        startBox: z
          .looseObject({
            left: z.number(),
            right: z.number(),
            top: z.number(),
            bottom: z.number(),
          })
          .nullish(),
      }),
    )
    .nullish(),
  Spectators: z.array(z.looseObject({ name: z.string().nullish() })).nullish(),
})
export const entrySchema = z.strictObject({
  bar_api: replaySchema,
  remarks: z.string().default(''),
  build_order: z.string().default(''),
  recorded_build_order: recordingSchema.nullish(),
})
export const replayUrlSchema = z
  .string()
  .trim()
  .regex(
    /^https?:\/\/(?:www\.)?bar-rts\.com\/replays\/[a-f0-9]{32}\/?$/i,
    'Enter a BAR replay URL with a 32-character replay ID.',
  )
export const entriesSchema = z.record(replayUrlSchema, entrySchema)
export const entryResponseSchema = z.strictObject({
  replay_url: replayUrlSchema,
  entry: entrySchema,
})
export const recordingResponseSchema = z.strictObject({
  replay_url: replayUrlSchema,
  recording: recordingSchema.nullable(),
})
export const statusSchema = z.strictObject({
  database_path: z.string(),
  storage: z.literal('sqlite'),
  count,
})
const assetState = z.strictObject({
  state: z.enum(['cached', 'missing', 'failed']),
  error: z.string().nullish(),
})
export const assetStatusSchema = z.strictObject({
  maps: z.record(z.string(), assetState),
  units: z.record(z.string(), assetState),
  entries: z.record(
    z.string(),
    z.strictObject({ map: z.string().nullable(), units: z.array(z.string()) }),
  ),
})
export const assetRefreshSchema = z.strictObject({
  refreshed: z.array(z.string()),
  failed: z.array(z.strictObject({ map: z.string(), error: z.string() })),
  units_refreshed: z.array(z.string()).default([]),
  units_failed: z
    .array(z.strictObject({ unit: z.string(), error: z.string() }))
    .default([]),
  status_warning: z.string().nullish(),
})
export type Replay = z.infer<typeof replaySchema>
export type Player = z.infer<typeof playerSchema>
export type Entry = z.infer<typeof entrySchema>
export type Entries = z.infer<typeof entriesSchema>
export type Recording = z.infer<typeof recordingSchema>
export type Summary = z.infer<typeof summarySchema>
