import { describe, expect, it } from 'vitest'
import { csvFor, importFile, recording } from '@/test/fixtures'
import { statisticsFixture } from '@/test/statistics-fixture'
import { parseRecording, readImport, recordingWarnings } from './recording'
import { statisticsSchema } from './recording-statistics-schema'
import { existingCounts, recordedValues, sampleAt, statisticsMaximum, sumStatistic } from './recording-statistics'

describe('recording statistics', () => {
  it('uses only the latest non-stale snapshot at or before the cutoff', () => {
    const stats = statisticsFixture()
    const team = stats.teams[0]
    expect(sampleAt(stats, team, -1)).toBeNull()
    expect(sampleAt(stats, team, 4.99)?.values.metalIncome).toBe(1)
    expect(sampleAt(stats, team, 5)?.values.metalIncome).toBe(10)
    expect(sampleAt(stats, team, 9)?.values.metalIncome).toBe(10)
    expect(sampleAt(stats, team, 16)).toBeNull() // missing snapshot, not a held-forward guess
    expect(sampleAt(stats, team, 20)?.values.metalIncome).toBe(40)
    expect(sampleAt(stats, team, 21)).toBeNull()
    stats.started_frame = 150
    expect(sampleAt(stats, team, 0)).toBeNull()
  })

  it('never treats a missing player metric as zero when combining allies', () => {
    expect(sumStatistic([{ metalIncome: 10 }, { metalIncome: 5 }], 'metalIncome')).toBe(15)
    expect(sumStatistic([{ energyIncome: 10 }, { energyIncome: null }], 'energyIncome')).toBeNull()
    expect(sumStatistic([], 'energyIncome')).toBeNull()
  })

  it('counts creation/completion/removal boundaries and recycled unit IDs separately', () => {
    const rows = parseRecording(csvFor(
      { player: 'Alice', unit_id: '1', building: 'Mex', unit_def_id: '10', start_seconds: '1', finish_seconds: '3', removed_seconds: '8', status: 'finished_then_removed' },
      { player: 'Alice', unit_id: '2', building: 'Mex', unit_def_id: '10', start_seconds: '2', removed_seconds: '4', status: 'removed_before_completion' },
      { player: 'Alice', unit_id: '1', building: 'Mex', unit_def_id: '10', start_seconds: '9', finish_seconds: '10', status: 'finished' },
    ))
    expect(existingCounts(rows, recording, 0)).toEqual([])
    expect(existingCounts(rows, recording, 2)[0]).toMatchObject({ completed: 0, constructing: 2 })
    expect(existingCounts(rows, recording, 3)[0]).toMatchObject({ completed: 1, constructing: 1 })
    expect(existingCounts(rows, recording, 4)[0]).toMatchObject({ completed: 1, constructing: 0 })
    expect(existingCounts(rows, recording, 8)).toEqual([])
    expect(existingCounts(rows, recording, 9)[0]).toMatchObject({ completed: 0, constructing: 1 })
    expect(existingCounts(rows, recording, 10)[0]).toMatchObject({ completed: 1, constructing: 0 })
    expect(statisticsMaximum(recording, rows)).toBe(10)
  })

  it('does not infer a historical completion time from an export-time status', () => {
    const rows = parseRecording(csvFor({ start_seconds: '1', status: 'finished', building: 'Mex' }))
    expect(existingCounts(rows, recording, 2)[0]).toMatchObject({ completed: 0, constructing: 0, unknown: 1 })
    const missingRemoval = parseRecording(csvFor({ start_seconds: '1', finish_seconds: '2', status: 'finished_then_removed' }))
    expect(existingCounts(missingRemoval, recording, 5)).toEqual([])
  })

  it('calculates version-matched replacement values only for completed surviving records', () => {
    const rows = parseRecording(csvFor(
      { unit_def_id: '10', start_seconds: '1', finish_seconds: '3', removed_seconds: '8' },
      { unit_def_id: '10', start_seconds: '9', finish_seconds: '10' },
    ))
    const source = { ...recording, unit_map: {
      game: 'BAR', game_version: 'test', map: 'Aurelia', replay_file: 'match.sdfz',
      units: { '10': { display_name: 'Pawn', internal_name: 'armpw', is_building: false,
        is_factory: false, metal_cost: 50, energy_cost: 600, category: 'army' as const } },
    } }
    expect(recordedValues(rows, source, 2).valueArmy).toBe(0)
    expect(recordedValues(rows, source, 3).valueArmy).toBe(60)
    expect(recordedValues(rows, source, 8).valueArmy).toBe(0)
    expect(recordedValues(rows, source, 10).valueArmy).toBe(60)
    expect(recordedValues(rows, recording, 10)).toEqual({})
    expect(recordedValues([{ ...rows[0], unit_def_id: '99' }], source, 4)).toEqual({})
  })

  it.each([
    (s: ReturnType<typeof statisticsFixture>) => { s.metrics.push(s.metrics[0]) },
    (s: ReturnType<typeof statisticsFixture>) => { s.teams.push(s.teams[0]) },
    (s: ReturnType<typeof statisticsFixture>) => { s.teams[0].samples[0].values.pop() },
    (s: ReturnType<typeof statisticsFixture>) => { s.teams[0].samples[1].frame = 0 },
    (s: ReturnType<typeof statisticsFixture>) => { s.teams[0].samples[0].frame = 999 },
    (s: ReturnType<typeof statisticsFixture>) => { s.teams[0].samples[0].values[0] = Infinity },
    (s: ReturnType<typeof statisticsFixture>) => { s.started_frame = 601 },
  ])('rejects malformed statistics', (mutate) => {
    const stats = statisticsFixture()
    mutate(stats)
    expect(statisticsSchema.safeParse(stats).success).toBe(false)
  })

  it('imports statistics independently, warns about mismatches, and clears them on CSV replacement', async () => {
    const stats = statisticsFixture()
    const imported = await readImport(importFile(JSON.stringify(stats), 'stats.json'), recording)
    expect(imported.statistics).toEqual(stats)
    expect(imported.statistics_filename).toBe('stats.json')
    expect(recordingWarnings(imported, parseRecording(recording.csv), {
      fileName: 'different.sdfz', gameVersion: 'other',
    })).toContain('Statistics reports a different replay filename.')
    expect((await readImport(importFile(recording.csv, 'new.csv'), imported)).statistics).toBeNull()
    await expect(readImport(importFile(JSON.stringify({ ...stats, schema_version: 2 }), 'stats.json'), imported)).rejects.toThrow()
    expect(imported.statistics).toEqual(stats)
    expect(statisticsMaximum(imported, parseRecording(recording.csv))).toBe(20)
  })
})
