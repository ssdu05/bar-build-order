import Papa from 'papaparse'
import { z } from 'zod'
import { statisticsSchema } from './recording-statistics-schema'
import {
  summarySchema,
  unitMapSchema,
  type Recording,
  type Replay,
} from './schemas'

export const columns = [
  'start_time',
  'finish_time',
  'removed_time',
  'status',
  'player',
  'team_id',
  'building',
  'unit_name',
  'unit_def_id',
  'unit_id',
  'builder_id',
  'builder_name',
  'x',
  'y',
  'z',
  'facing',
  'start_seconds',
  'finish_seconds',
  'removed_seconds',
  'start_frame',
  'finish_frame',
  'removed_frame',
  'owner_at_end',
  'map',
  'replay_file',
  'unit_kind',
] as const
const rowSchema = z.object({
  ...(Object.fromEntries(columns.map((key) => [key, z.string()])) as Record<
    (typeof columns)[number],
    z.ZodString
  >),
  unit_kind: z.enum(['building', 'unit']),
})
export type BuildRow = z.infer<typeof rowSchema> & { key: string; run: string }

export function numeric(value: string) {
  return value.trim() && Number.isFinite(Number(value)) ? Number(value) : null
}
export function eventSeconds(
  row: BuildRow,
  kind: 'start' | 'finish' | 'removed' = 'start',
): number | null {
  const seconds = numeric(row[`${kind}_seconds`])
  if (seconds !== null) return seconds
  const frame = numeric(row[`${kind}_frame`])
  if (frame !== null) return frame / 30
  const parts = row[`${kind}_time`].split(':')
  return parts.length >= 2 &&
    parts.every((p) => p.trim() && Number.isFinite(Number(p)))
    ? parts.reduce((n, p) => n * 60 + Number(p), 0)
    : null
}
export const completed = (row: BuildRow) =>
  ['finished', 'finished_then_removed'].includes(row.status) ||
  eventSeconds(row, 'finish') !== null
export const resolvedName = (row: BuildRow, recording?: Recording | null) =>
  recording?.unit_map?.units[row.unit_def_id]?.display_name ||
  row.building ||
  row.unit_name ||
  `UnitDef ${row.unit_def_id}`
export function internalName(row: BuildRow, recording?: Recording | null) {
  const value = (
    row.unit_name ||
    recording?.unit_map?.units[row.unit_def_id]?.internal_name ||
    ''
  )
    .trim()
    .toLowerCase()
  return /^[a-z][a-z0-9_]{0,79}$/.test(value) ? value : ''
}
export function parseRecording(csv: string): BuildRow[] {
  if (new TextEncoder().encode(csv).length > 10 * 1024 * 1024)
    throw new Error('Recording CSV must be at most 10 MiB.')
  const parsed = Papa.parse<string[]>(csv.replace(/^\uFEFF/, ''), {
    skipEmptyLines: true,
  })
  if (parsed.errors.length)
    throw new Error(`Invalid CSV: ${parsed.errors[0].message}`)
  const [headers, ...data] = parsed.data
  if (
    !headers ||
    headers.length !== columns.length ||
    headers.some((key, i) => key !== columns[i])
  )
    throw new Error(
      'Expected the current 26-column RealBO CSV, including unit_kind.',
    )
  const records = data.filter((row) => row.some((value) => value !== ''))
  if (records.length > 50_000)
    throw new Error('CSV has too many records (max 50,000).')
  const rows = records
    .map((values, i) => {
      if (values.length !== columns.length)
        throw new Error(
          `CSV data row ${i + 1} must contain all ${columns.length} columns.`,
        )
      const result = rowSchema.safeParse(
        Object.fromEntries(columns.map((key, j) => [key, values[j]])),
      )
      if (!result.success)
        throw new Error(
          `CSV data row ${i + 1} must have unit_kind building or unit.`,
        )
      return { ...result.data, key: String(i), run: '' }
    })
    .sort(
      (a, b) =>
        (numeric(a.start_frame) ?? (eventSeconds(a) ?? 0) * 30) -
        (numeric(b.start_frame) ?? (eventSeconds(b) ?? 0) * 30),
    )
  // Compute runs before filtering: hiding an intervening type must not merge runs.
  const last = new Map<string, { type: string; run: string }>()
  for (const row of rows) {
    const owner = JSON.stringify([row.team_id, row.player])
    const type = row.unit_def_id || row.unit_name || row.building || row.key
    const previous = last.get(owner)
    row.run = previous?.type === type ? previous.run : row.key
    last.set(owner, { type, run: row.run })
  }
  return rows
}

// Input is the complete, chronologically sorted recording, before any filters.
export function constructorBuilds(rows: BuildRow[]) {
  const lifetimes = new Map<string, BuildRow>()
  const constructors = new Map<string, { name: string; order: number }>()
  const last = new Map<string, { type: string; run: string }>()
  const builds = rows.map((row) => {
    const id = row.builder_id.trim()
    const source = id ? lifetimes.get(id) : undefined
    const constructorKey = JSON.stringify([
      row.team_id,
      row.player,
      id,
      source?.key ?? '',
    ])
    const name =
      row.builder_name.trim() || source?.building || source?.unit_name || ''
    let constructor = constructors.get(constructorKey)
    if (!constructor) {
      constructor = { name, order: constructors.size }
      constructors.set(constructorKey, constructor)
    } else if (!constructor.name) constructor.name = name

    const type = JSON.stringify([
      row.unit_kind,
      row.unit_def_id || row.unit_name || row.building || row.key,
    ])
    const previous = last.get(constructorKey)
    // A name without an ID cannot establish that two builds share a constructor.
    const constructorRun =
      id && previous?.type === type ? previous.run : row.key
    last.set(constructorKey, { type, run: constructorRun })
    // Unit IDs can be recycled after destruction: a new creation is a new builder.
    if (row.unit_id.trim()) lifetimes.set(row.unit_id.trim(), row)
    return {
      ...row,
      constructorKey,
      constructorRun,
      constructorOrder: constructor.order,
    }
  })
  return builds.map((row) => {
    const id = row.builder_id.trim()
    const name = constructors.get(row.constructorKey)!.name
    return {
      ...row,
      constructorLabel: id
        ? `${name || 'Constructor / factory'} #${id}`
        : 'Unknown constructor / factory',
    }
  })
}

export function exportRecording(rows: BuildRow[]) {
  // Escape formula-like cells for spreadsheet safety. The original archive is untouched.
  return (
    Papa.unparse(
      {
        fields: [...columns],
        data: rows.map((row) => columns.map((key) => row[key])),
      },
      { quotes: true, escapeFormulae: true, newline: '\r\n' },
    ) + '\r\n'
  )
}
const basename = (value?: string | null) =>
  (value || '')
    .replaceAll('\\', '/')
    .split('/')
    .at(-1)!
    .replace(/\.sdfz$/i, '')
const version = (value?: string | null) =>
  (value || '')
    .trim()
    .replace(/^Beyond All Reason\s+/i, '')
    .trim()

export function recordingWarnings(
  recording: Recording,
  rows: BuildRow[],
  api: Replay,
) {
  const issues: string[] = []
  const replay = basename(api.fileName)
  const files = new Set(
    rows.map((row) => basename(row.replay_file)).filter(Boolean),
  )
  if (files.size > 1 || (replay && [...files].some((file) => file !== replay)))
    issues.push('CSV replay filename differs from the selected replay.')
  if (
    api.Map?.scriptName &&
    rows.some((row) => row.map && row.map !== api.Map?.scriptName)
  )
    issues.push('CSV map differs from the selected replay.')
  for (const [label, meta] of [
    ['Unit definitions', recording.unit_map],
    ['Summary', recording.summary],
    ['Statistics', recording.statistics],
  ] as const) {
    if (!meta) continue
    const file = basename(meta.replay_file)
    if (
      file &&
      ((replay && file !== replay) || [...files].some((item) => item !== file))
    )
      issues.push(`${label} reports a different replay filename.`)
    if (
      meta.map &&
      ((api.Map?.scriptName && meta.map !== api.Map.scriptName) ||
        rows.some((row) => row.map && row.map !== meta.map))
    )
      issues.push(`${label} reports a different map.`)
    if (
      version(meta.game_version) &&
      version(api.gameVersion) &&
      version(meta.game_version) !== version(api.gameVersion)
    )
      issues.push(`${label} reports a different game version.`)
  }
  if (recording.summary && recording.summary.counts.started !== rows.length)
    issues.push(
      'Summary counts differ from the CSV; these may be different export snapshots.',
    )
  if (recording.statistics && recording.summary &&
      recording.statistics.export_frame !== recording.summary.export_frame)
    issues.push('Statistics and summary have different export frames; these may be different export snapshots.')
  return issues
}

export async function readImport(
  file: File,
  prior?: Recording | null,
): Promise<Recording> {
  const isCSV = /\.csv$/i.test(file.name)
  if (!isCSV && !/\.json$/i.test(file.name))
    throw new Error('Choose a .csv or .json file.')
  const maximum = 10
  if (file.size > maximum * 1024 * 1024)
    throw new Error(`File must be at most ${maximum} MiB.`)
  const text = new TextDecoder('utf-8', {
    fatal: true,
    ignoreBOM: true,
  }).decode(await file.arrayBuffer())
  if (isCSV) {
    parseRecording(text)
    return {
      csv: text,
      filename: file.name,
      unit_map: null,
      unit_map_filename: '',
      summary: null,
      summary_filename: '',
      statistics: null,
      statistics_filename: '',
    }
  }
  if (!prior) throw new Error('Import a recording CSV first.')
  const root: unknown = JSON.parse(text.replace(/^\uFEFF/, ''))
  if (root && typeof root === 'object' && 'format' in root && root.format === 'realbo_statistics') {
    return {
      ...prior,
      statistics: statisticsSchema.parse(root),
      statistics_filename: file.name,
    }
  }
  if (
    root &&
    typeof root === 'object' &&
    'format' in root &&
    root.format === 'realbo_summary'
  ) {
    if (file.size > 1024 * 1024)
      throw new Error('Summary JSON must be at most 1 MiB.')
    return {
      ...prior,
      summary: summarySchema.parse(root),
      summary_filename: file.name,
    }
  }
  if (file.size > 5 * 1024 * 1024)
    throw new Error('Unit definitions must be at most 5 MiB.')
  return {
    ...prior,
    unit_map: unitMapSchema.parse(root),
    unit_map_filename: file.name,
  }
}
