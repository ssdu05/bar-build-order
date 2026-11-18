import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { Recording } from '@/lib/schemas'
import { createRecordingTimeline } from '@/lib/recording-timeline'
import { parseRecording } from '@/lib/recording'
import { csvFor, recording } from '@/test/fixtures'
import { statisticsFixture } from '@/test/statistics-fixture'
import { RecordingStatistics } from './RecordingStatistics'

function mount(source: Recording = { ...recording, statistics: statisticsFixture(), statistics_filename: 'match_statistics.json' }) {
  const timeline = createRecordingTimeline(20)
  timeline.begin()
  timeline.preview(5)
  const onPlayerChange = vi.fn()
  const rows = parseRecording(csvFor(
    { team_id: '0', player: 'Alice', building: 'Mex', unit_name: 'armmex', unit_def_id: '10', start_seconds: '1', finish_seconds: '3', removed_seconds: '8', status: 'finished_then_removed' },
    { team_id: '1', player: 'Bob', building: 'Pawn', unit_name: 'armpw', unit_kind: 'unit', unit_def_id: '20', start_seconds: '2', finish_seconds: '4' },
  ))
  const props = { rows, countRows: rows, recording: source, timeline, player: '', onPlayerChange }
  const view = render(<RecordingStatistics {...props} />)
  return { ...view, props, timeline }
}

it('previews per-player statistics live and sums allied values without hiding missing data', () => {
  const { timeline } = mount()
  const table = screen.getByRole('table', { name: 'Player statistics' })
  expect(within(table).getByRole('columnheader', { name: 'Alice' })).toBeInTheDocument()
  const army = within(table).getByRole('row', { name: /Mobile army value/ })
  expect(within(army).getAllByRole('cell').map((c) => c.textContent)).toEqual([
    'Mobile army value (ground + air + navy)', '250', '100',
  ])
  fireEvent.click(screen.getByRole('button', { name: 'Group allied players' }))
  expect(within(table).getByRole('columnheader', { name: 'Allied side 1' })).toBeInTheDocument()
  expect(within(army).getAllByRole('cell')[1]).toHaveTextContent('350')
  expect(screen.getByText('Energy income /s').nextSibling).toHaveTextContent('Not recorded')
  expect(screen.getByLabelText('Existing counts')).toHaveTextContent('1 completed buildings · 1 completed units')
  act(() => timeline.preview(8))
  expect(screen.getByLabelText('Existing counts')).toHaveTextContent('0 completed buildings · 1 completed units')
  act(() => timeline.preview(10))
  expect(within(army).getAllByRole('cell')[1]).toHaveTextContent('650')
  timeline.dispose()
})

it('shows cached building/unit icons beside type names and refreshes failed artwork', () => {
  const { rerender, props, timeline } = mount()
  fireEvent.click(screen.getByText(/^Existing buildings \/ units by type/))
  const table = screen.getByRole('table', { name: 'Existing buildings and units' })
  const mex = within(table).getByText('Mex').querySelector('img')!
  const pawn = within(table).getByText('Pawn').querySelector('img')!
  expect(mex).toHaveAttribute('src', '/api/assets/units/armmex?v=0')
  expect(pawn).toHaveAttribute('src', '/api/assets/units/armpw?v=0')
  fireEvent.error(mex)
  expect(mex).toHaveAttribute('src', '/unit-placeholder.svg')
  rerender(<RecordingStatistics {...props} version={2} />)
  expect(mex).toHaveAttribute('src', '/api/assets/units/armmex?v=2')
  timeline.dispose()
})

it('filters individual players and reports missing snapshots instead of future values', () => {
  const { rerender, props, timeline } = mount()
  rerender(<RecordingStatistics {...props} player="Alice" />)
  const table = screen.getByRole('table', { name: 'Player statistics' })
  expect(within(table).queryByRole('columnheader', { name: 'Bob' })).not.toBeInTheDocument()
  act(() => timeline.preview(16))
  expect(within(table).getByRole('row', { name: /Mobile army value/ })).toHaveTextContent('Not recorded')
  timeline.dispose()
})

it('keeps old recordings useful and clearly labels unrecorded economy data', () => {
  const { timeline } = mount(recording)
  expect(screen.getByRole('status')).toHaveTextContent('Not recorded')
  expect(screen.getByRole('button', { name: 'Group allied players' })).toBeDisabled()
  expect(screen.queryByText('History graphs')).not.toBeInTheDocument()
  expect(screen.queryByRole('combobox', { name: 'Graph statistic' })).not.toBeInTheDocument()
  expect(screen.getByLabelText('Existing counts')).toHaveTextContent('1 completed buildings · 1 completed units')
  timeline.dispose()
})
