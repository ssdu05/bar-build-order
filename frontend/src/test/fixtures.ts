import Papa from 'papaparse'
import { columns } from '@/lib/recording'
import type { Entries, Recording, Summary } from '@/lib/schemas'

export const url = `https://bar-rts.com/replays/${'a'.repeat(32)}`
export const secondUrl = `https://bar-rts.com/replays/${'b'.repeat(32)}`
export function csvFor(
  ...rows: Partial<Record<(typeof columns)[number], string>>[]
) {
  return (
    Papa.unparse(
      {
        fields: [...columns],
        data: rows.map((row) =>
          columns.map(
            (key) =>
              ({
                unit_kind: 'building',
                map: 'Aurelia',
                replay_file: 'match.sdfz',
                ...row,
              })[key] || '',
          ),
        ),
      },
      { quotes: true },
    ) + '\r\n'
  )
}
export const csv = csvFor(
  {
    player: 'Alice',
    team_id: '0',
    building: 'Metal Extractor',
    unit_name: 'cormex',
    unit_id: '1',
    unit_def_id: '10',
    start_seconds: '1',
    start_time: '00:01',
    finish_seconds: '4',
    finish_time: '00:04',
    status: 'finished',
    x: '100',
    z: '200',
  },
  {
    player: 'Alice',
    team_id: '0',
    building: 'Metal Extractor',
    unit_name: 'cormex',
    unit_id: '2',
    unit_def_id: '10',
    start_seconds: '5',
    start_time: '00:05',
    status: 'unfinished_at_end',
    x: '300',
    z: '400',
  },
  {
    player: 'Bob',
    team_id: '1',
    building: 'Pawn',
    unit_name: 'armpw',
    unit_id: '3',
    unit_def_id: '20',
    start_seconds: '8',
    start_time: '00:08',
    finish_time: '00:10',
    status: 'finished',
    unit_kind: 'unit',
    x: '600',
    z: '800',
  },
)
export const recording: Recording = {
  csv,
  filename: 'match_all_units_buildings.csv',
  unit_map_filename: '',
  summary_filename: '',
  statistics_filename: '',
}
export function summaryFor(started = 3): Summary {
  return {
    format: 'realbo_summary',
    schema_version: 1,
    replay_file: 'match.sdfz',
    map: 'Aurelia',
    game_version: 'test-1',
    export_time: '00:10',
    game_over: true,
    full_replay_captured: true,
    skipped_frames: false,
    rewind_detected: false,
    started_frame: 0,
    export_frame: 300,
    counts: {
      started,
      buildings: started,
      units: 0,
      completed: started,
      removed_before_completion: 0,
      unfinished: 0,
    },
  }
}
export function entriesFixture(): Entries {
  return {
    [url]: {
      bar_api: {
        id: 'a'.repeat(32),
        fileName: 'match.sdfz',
        gameVersion: 'Beyond All Reason test-1',
        preset: 'duel',
        startTime: '2026-11-05T16:00:00Z',
        durationMs: 600_000,
        Map: {
          scriptName: 'Aurelia',
          fileName: 'aurelia',
          width: 14,
          height: 14,
        },
        gameSettings: { ranked_game: '1' },
        AllyTeams: [
          {
            winningTeam: true,
            Players: [
              {
                name: 'Alice',
                teamId: 0,
                faction: 'Cortex',
                skill: '[26.22]',
                startPos: { x: 1000, z: 2000 },
              },
            ],
          },
          {
            Players: [{ name: 'Bob', teamId: 1, faction: 'Armada', skill: 0 }],
          },
        ],
      },
      remarks: 'Original notes',
      build_order: '2 mex → solar',
    },
    [secondUrl]: {
      bar_api: {
        id: 'b'.repeat(32),
        Map: { scriptName: 'Other map' },
        gameSettings: { ranked_game: false },
      },
      remarks: '',
      build_order: '',
    },
  }
}
export function importFile(text: string, name: string) {
  const file = new File([text], name)
  Object.defineProperty(file, 'arrayBuffer', {
    value: async () => new TextEncoder().encode(text).buffer,
  })
  return file
}
