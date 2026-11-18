import { describe, expect, it } from 'vitest'
import {
  completed,
  constructorBuilds,
  eventSeconds,
  exportRecording,
  parseRecording,
  readImport,
  recordingWarnings,
  resolvedName,
} from './recording'
import { entriesSchema, summarySchema, unitMapSchema } from './schemas'
import {
  csv,
  csvFor,
  entriesFixture,
  importFile,
  recording,
  summaryFor,
  url,
} from '@/test/fixtures'

describe('Papa Parse recording parser', () => {
  it('handles BOM, CRLF, commas, quotes, multiline cells and Unicode', () => {
    const name = 'Metal, "Extractor"\n第二'
    const rows = parseRecording(
      '\uFEFF' + csvFor({ building: name, unit_kind: 'unit' }),
    )
    expect(rows[0].building).toBe(name)
    expect(rows[0].unit_kind).toBe('unit')
  })
  it('sorts events by start frame and resolves seconds from frames or time labels', () => {
    const rows = parseRecording(
      csvFor(
        { start_frame: '300', start_time: '00:10' },
        { start_frame: '30', start_time: '00:01' },
      ),
    )
    expect(eventSeconds(rows[0])).toBe(1)
    expect(eventSeconds(rows[1])).toBe(10)
  })
  it.each([
    'x,y\n1,2',
    csv.replace('unit_kind', 'kind'),
    csv.replace('"building"', '"other"'),
    csv + '"unterminated',
  ])('rejects invalid CSV without guessing its format', (text) => {
    expect(() => parseRecording(text)).toThrow()
  })
  it('rejects truncated records', () => {
    expect(() =>
      parseRecording(csv.split('\r\n')[0] + '\r\n"00:01","finished"'),
    ).toThrow('all 26 columns')
  })
  it('rejects oversized CSV and excessive row counts', () => {
    expect(() => parseRecording('x'.repeat(10 * 1024 * 1024 + 1))).toThrow(
      '10 MiB',
    )
    const sample = csvFor({}).split('\r\n')
    expect(() =>
      parseRecording(sample[0] + '\r\n' + (sample[1] + '\r\n').repeat(50_001)),
    ).toThrow('50,000')
  })
  it('assigns runs per player before filtering; other players do not interrupt runs', () => {
    const rows = parseRecording(
      csvFor(
        { player: 'Alice', unit_def_id: '10', start_seconds: '1' },
        { player: 'Bob', unit_def_id: '20', start_seconds: '2' },
        { player: 'Alice', unit_def_id: '10', start_seconds: '3' },
        { player: 'Alice', unit_def_id: '30', start_seconds: '4' },
        { player: 'Alice', unit_def_id: '10', start_seconds: '5' },
      ),
    )
    expect(rows[0].run).toBe(rows[2].run)
    expect(rows[4].run).not.toBe(rows[0].run)
  })
  it('exports all original columns via Papa Parse and round-trips ordinary cells', () => {
    const rows = parseRecording(csv)
    expect(
      parseRecording(exportRecording(rows)).map((row) => row.unit_id),
    ).toEqual(['1', '2', '3'])
    expect(
      exportRecording(parseRecording(csvFor({ building: '=1+1' }))),
    ).toContain("'=1+1")
  })
  it('does not infer completion from removed status alone', () => {
    const rows = parseRecording(
      csvFor(
        { status: 'removed_before_completion' },
        { status: 'finished_then_removed' },
        { finish_frame: '120' },
      ),
    )
    expect(rows.map(completed)).toEqual([false, true, true])
  })
})

describe('constructor build sequences', () => {
  it('groups consecutive types per individual constructor, not per name or player', () => {
    const build = {
      player: 'Alice',
      builder_id: '1',
      builder_name: 'Bot',
      unit_def_id: '10',
    }
    const rows = constructorBuilds(
      parseRecording(
        csvFor(
          { ...build, start_seconds: '1' },
          { ...build, builder_id: '2', unit_def_id: '20', start_seconds: '2' },
          { ...build, player: 'Bob', builder_id: '3', start_seconds: '3' },
          { ...build, builder_name: '', start_seconds: '4' },
          { ...build, unit_def_id: '20', start_seconds: '5' },
          { ...build, start_seconds: '6' },
        ),
      ),
    )
    expect(rows[0].constructorRun).toBe(rows[3].constructorRun)
    expect(rows[0].constructorRun).not.toBe(rows[5].constructorRun)
    expect(rows[0].constructorKey).not.toBe(rows[1].constructorKey)
    expect(rows[0].constructorLabel).toBe('Bot #1')
    expect(rows[3].constructorLabel).toBe('Bot #1')
    expect(rows[1].constructorLabel).toBe('Bot #2')
    expect(rows.map((row) => row.constructorOrder)).toEqual([0, 1, 2, 0, 0, 0])
  })
  it('keeps unknown builders separate, even with identical names; separates owners', () => {
    const rows = constructorBuilds(
      parseRecording(
        csvFor(
          { builder_name: 'Bot', unit_def_id: '10', start_seconds: '1' },
          { builder_name: 'Bot', unit_def_id: '10', start_seconds: '2' },
          {
            team_id: '0',
            player: 'Alice',
            builder_id: '1',
            unit_def_id: '10',
            start_seconds: '3',
          },
          {
            team_id: '1',
            player: 'Alice',
            builder_id: '1',
            unit_def_id: '10',
            start_seconds: '4',
          },
        ),
      ),
    )
    expect(rows[0].constructorLabel).toBe('Unknown constructor / factory')
    expect(rows[0].constructorRun).not.toBe(rows[1].constructorRun)
    expect(rows[2].constructorKey).not.toBe(rows[3].constructorKey)
    expect(rows[2].constructorLabel).toBe('Constructor / factory #1')
  })
  it('resolves missing builder names from observed units and separates recycled IDs', () => {
    const rows = constructorBuilds(
      parseRecording(
        csvFor(
          {
            unit_id: '1',
            building: 'Construction Bot',
            start_seconds: '0',
            removed_seconds: '3',
          },
          { builder_id: '1', unit_def_id: '10', start_seconds: '1' },
          { builder_id: '1', unit_def_id: '10', start_seconds: '2' },
          { unit_id: '1', building: 'Vehicle Plant', start_seconds: '4' },
          { builder_id: '1', unit_def_id: '10', start_seconds: '5' },
        ),
      ),
    )
    expect(rows[1].constructorLabel).toBe('Construction Bot #1')
    expect(rows[1].constructorRun).toBe(rows[2].constructorRun)
    expect(rows[4].constructorLabel).toBe('Vehicle Plant #1')
    expect(rows[1].constructorKey).not.toBe(rows[4].constructorKey)
    expect(rows[1].constructorRun).not.toBe(rows[4].constructorRun)
    expect(parseRecording(exportRecording(rows))).toHaveLength(5)
  })
})

describe('Zod external data and imports', () => {
  it('validates summary totals, booleans, unknown fields and safe integer counts', () => {
    expect(summarySchema.parse(summaryFor()).counts.started).toBe(3)
    expect(
      summarySchema.safeParse({ ...summaryFor(), game_over: 'true' }).success,
    ).toBe(false)
    expect(
      summarySchema.safeParse({ ...summaryFor(), extra: 'old format' }).success,
    ).toBe(false)
    const summary = summaryFor()
    summary.counts.units = 1
    expect(() => summarySchema.parse(summary)).toThrow('do not add up')
    expect(
      summarySchema.safeParse({
        ...summaryFor(),
        started_frame: Number.MAX_SAFE_INTEGER + 1,
      }).success,
    ).toBe(false)
  })
  it('accepts only detailed unit definitions with valid numeric keys', () => {
    expect(unitMapSchema.safeParse({ units: { 10: 'Mex' } }).success).toBe(
      false,
    )
    expect(
      unitMapSchema.safeParse({
        game: 'BAR',
        game_version: '',
        map: '',
        replay_file: '',
        units: {},
      }).success,
    ).toBe(false)
  })
  it('preserves unknown snapshot fields and rejects unknown storage fields', () => {
    const fixture = entriesFixture()
    fixture[url].bar_api.extra = { nested: ['saved'] }
    expect(entriesSchema.parse(fixture)[url].bar_api.extra).toEqual({
      nested: ['saved'],
    })
    expect(
      entriesSchema.safeParse({ [url]: { ...fixture[url], legacy: true } })
        .success,
    ).toBe(false)
  })
  it('replacement CSV retains exact archive bytes and clears old metadata', async () => {
    const next = await readImport(importFile('\uFEFF' + csv, 'new.csv'), {
      ...recording,
      summary: summaryFor(),
    })
    expect(next.csv).toBe('\uFEFF' + csv)
    expect(next.summary).toBeNull()
    expect(next.unit_map).toBeNull()
  })
  it('requires CSV before JSON and detects summary JSON automatically', async () => {
    await expect(readImport(importFile('{}', 'mapping.json'))).rejects.toThrow(
      'CSV first',
    )
    const result = await readImport(
      importFile(JSON.stringify(summaryFor()), 'summary.json'),
      recording,
    )
    expect(result.summary?.format).toBe('realbo_summary')
    expect(result.csv).toBe(csv)
  })
  it('resolves names using UnitDef IDs, not individual unit IDs', () => {
    const rows = parseRecording(csv)
    const map = {
      game: 'BAR',
      game_version: '',
      replay_file: '',
      map: '',
      units: {
        '10': {
          display_name: 'Resolved mex',
          internal_name: 'cormex',
          is_building: true,
          is_factory: false,
        },
      },
    }
    expect(resolvedName(rows[0], { ...recording, unit_map: map })).toBe(
      'Resolved mex',
    )
  })
  it('rejects oversized files before reading', async () => {
    const file = importFile('', 'huge.csv')
    Object.defineProperty(file, 'size', { value: 11 * 1024 * 1024 })
    await expect(readImport(file)).rejects.toThrow('10 MiB')
  })
  it('ignores the game title prefix, but warns about actual metadata mismatches', () => {
    const current = { ...recording, summary: summaryFor() }
    expect(
      recordingWarnings(
        current,
        parseRecording(csv),
        entriesFixture()[url].bar_api,
      ),
    ).toEqual([])
    current.summary.game_version = 'test-other'
    expect(
      recordingWarnings(
        current,
        parseRecording(csv),
        entriesFixture()[url].bar_api,
      ),
    ).toContain('Summary reports a different game version.')
    current.summary.counts.started = 10
    expect(
      recordingWarnings(
        current,
        parseRecording(csv),
        entriesFixture()[url].bar_api,
      ).join(' '),
    ).toContain('different export snapshots')
  })
})
