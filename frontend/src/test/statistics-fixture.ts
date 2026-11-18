import type { RecordingStatistics } from '@/lib/recording-statistics-schema'

export function statisticsFixture(): RecordingStatistics {
  return {
    format: 'realbo_statistics', schema_version: 1,
    replay_file: 'match.sdfz', map: 'Aurelia', game_version: 'test-1',
    game_speed: 30, sample_period_frames: 150,
    started_frame: 0, export_frame: 600, game_over: true,
    full_replay_captured: true, truncated: false,
    metrics: ['metalIncome', 'metalProduced', 'valueArmy', 'valueAir', 'valueSea', 'energyIncome', 'metalReclaimIncome'],
    teams: [
      { team_id: 0, ally_team_id: 0, player: 'Alice',
        samples: [
          { frame: 0, values: [1, 0, 0, 0, 0, null, 0] },
          { frame: 150, values: [10, 100, 200, 50, 0, 500, 2] },
          { frame: 300, values: [20, 200, 400, 50, 0, 600, 2] },
          { frame: 600, values: [40, 400, 800, 50, 0, 800, 2] },
        ] },
      { team_id: 1, ally_team_id: 0, player: 'Bob',
        samples: [
          { frame: 0, values: [2, 0, 0, 0, 0, null, 0] },
          { frame: 150, values: [5, 50, 100, 0, 0, null, 0] },
          { frame: 300, values: [8, 80, 200, 0, 0, null, 0] },
        ] },
    ],
  }
}
