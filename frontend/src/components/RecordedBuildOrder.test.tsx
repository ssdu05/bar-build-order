import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import type { Library } from '@/hooks/use-library'
import { parseRecording } from '@/lib/recording'
import * as utils from '@/lib/utils'
import { csvFor, entriesFixture, recording, url } from '@/test/fixtures'
import { mockRecordingLayout } from '@/test/recording-layout'
import { statisticsFixture } from '@/test/statistics-fixture'
import { BuildOrderTable } from './RecordedBuildOrder'
import { CanvasPlacements } from './CanvasPlacements'
import { RecordingGraphs } from './RecordingGraphs'
import { useReactTable } from '@tanstack/react-table'

vi.mock('@tanstack/react-table', async (original) => {
  const actual = await original<typeof import('@tanstack/react-table')>()
  return { ...actual, useReactTable: vi.fn(actual.useReactTable) }
})

vi.mock('./CanvasPlacements', () => ({
  CanvasPlacements: vi.fn(() => null),
}))
vi.mock('./AssetStatus', () => ({
  AssetStatus: () => null,
}))
vi.mock('./RecordingGraphs', () => ({
  RecordingGraphs: vi.fn(() => <section aria-label="Recording graphs">Full-game graphs</section>),
}))

beforeEach(() => {
  mockRecordingLayout()
  vi.mocked(CanvasPlacements).mockClear()
})

function mount({
  summarize = false,
  byConstructor = false,
  diverse = false,
  includeFinish = false,
} = {}) {
  const source = {
    ...recording,
    csv: csvFor(
      ...Array.from({ length: 8000 }, (_, i) => ({
        player: 'Alice',
        team_id: '0',
        building: diverse ? `Building ${i % 100}` : 'Wind Turbine',
        unit_name: 'corwin',
        unit_def_id: diverse ? String(i % 100) : '10',
        unit_id: String(i + 1),
        builder_id: '9000',
        builder_name: 'Bot',
        start_seconds: String(i + 1),
        finish_seconds: includeFinish ? String(i + 61.5) : '',
        status: 'finished',
        x: '100',
        z: '200',
      })),
    ),
  }
  const result = render(
    <BuildOrderTable
      rows={parseRecording(source.csv)}
      recording={source}
      entry={entriesFixture()[url]}
      url={url}
      library={{ assets: { dataUpdatedAt: 1 } } as Library}
      onFilter={() => {}}
      preferences={{
        kind: '',
        summarize,
        view: byConstructor ? 'constructor' : 'timeline',
      }}
      setPreferences={() => {}}
    />,
  )
  return {
    ...result,
    list: screen.getByRole('region', { name: 'Build-order records' }),
    table: screen.getByRole('table'),
    slider: screen.getByRole('slider', { name: /Construction \/ production/ }),
  }
}

function mapCount() {
  const { placements, timeline } = vi.mocked(CanvasPlacements).mock.lastCall![0]
  return placements.filter((p) => (p.seconds ?? 0) <= timeline!.getSnapshot()).length
}

it('clears map selection when selecting a player or All, including the current option', async () => {
  const user = userEvent.setup()
  render(
    <BuildOrderTable
      rows={parseRecording(recording.csv)}
      recording={recording}
      entry={entriesFixture()[url]}
      url={url}
      library={{ assets: { dataUpdatedAt: 1 } } as Library}
      onFilter={() => {}}
      preferences={{ kind: '', summarize: false, view: 'timeline' }}
      setPreferences={() => {}}
    />,
  )
  await user.click(screen.getByRole('button', { name: 'Recording filters' }))

  for (const [player, count] of [
    ['Alice', 2],
    ['Alice', 2],
    ['Bob', 1],
    ['All', 3],
    ['All', 3],
  ] as const) {
    const selectAll = screen.getByRole('checkbox', {
      name: 'Select all filtered records for map',
    })
    await user.click(selectAll)
    expect(selectAll).toBeChecked()
    expect(screen.getByRole('button', { name: 'Clear map selection' })).toBeEnabled()

    await user.click(screen.getByRole('combobox', { name: 'Recording player' }))
    await user.click(screen.getByRole('option', { name: player, exact: true }))

    expect(screen.getByRole('button', { name: 'Clear map selection' })).toBeDisabled()
    expect(selectAll).not.toBeChecked()
    expect(screen.getByText('Map: all filtered records.')).toBeInTheDocument()
    expect(mapCount()).toBe(count)
  }
})

it('switches between Map & list, Statistics, and full-history Graphs while preserving the shared timestamp', async () => {
  const source = { ...recording, statistics: statisticsFixture() }
  source.statistics.export_frame = 601
  source.statistics.teams[0].samples.at(-1)!.frame = 601
  render(<BuildOrderTable rows={parseRecording(source.csv)} recording={source}
    entry={entriesFixture()[url]} url={url}
    library={{ assets: { dataUpdatedAt: 1 } } as Library} onFilter={() => {}}
    preferences={{ kind: '', summarize: false, view: 'timeline' }} setPreferences={() => {}} />)
  expect(screen.queryByRole('button', { name: 'Statistics' })).not.toBeInTheDocument()
  fireEvent.mouseDown(screen.getByRole('tab', { name: 'List' }), { button: 0, ctrlKey: false })
  const tab = screen.getByRole('tab', { name: 'Statistics' })
  expect(tab.closest('[role="tablist"]')).toHaveAttribute('aria-label', 'Recording views')
  expect(screen.queryByRole('region', { name: 'Recording statistics' })).not.toBeInTheDocument()
  fireEvent.mouseDown(tab, { button: 0, ctrlKey: false })
  expect(tab).toHaveAttribute('aria-selected', 'true')
  expect(screen.queryByRole('region', { name: 'Build-order records' })).not.toBeInTheDocument()
  expect(screen.queryByRole('tab', { name: 'Map' })).not.toBeInTheDocument()
  const panel = screen.getByRole('region', { name: 'Recording statistics' })
  expect(within(panel).getByRole('row', { name: /Mobile army value/ })).toHaveTextContent('850')
  const slider = screen.getByRole('slider', { name: 'Statistics timestamp' })
  expect(slider).toHaveAttribute('max', String(601 / 30))
  fireEvent.pointerDown(slider)
  fireEvent.change(slider, { target: { value: '5' } })
  expect(within(panel).getByRole('row', { name: /Mobile army value/ })).toHaveTextContent('250')
  fireEvent.pointerUp(window)
  const graphsTab = screen.getByRole('tab', { name: 'Graphs' })
  expect(graphsTab.previousElementSibling).toHaveTextContent('Statistics')
  fireEvent.mouseDown(graphsTab, { button: 0, ctrlKey: false })
  await screen.findByRole('region', { name: 'Recording graphs' })
  expect(screen.queryByRole('slider')).not.toBeInTheDocument()
  expect(screen.queryByRole('region', { name: 'Recording statistics' })).not.toBeInTheDocument()
  const graphSource = vi.mocked(RecordingGraphs).mock.lastCall![0].recording.statistics!
  expect(graphSource.teams).toHaveLength(2)
  expect(graphSource.teams[0].samples.at(-1)?.frame).toBe(601)
  fireEvent.mouseDown(screen.getByRole('tab', { name: 'Map & list' }), { button: 0, ctrlKey: false })
  expect(screen.queryByRole('region', { name: 'Recording statistics' })).not.toBeInTheDocument()
  expect(screen.getByRole('region', { name: 'Build-order records' })).toBeInTheDocument()
  expect(screen.getByRole('tab', { name: 'List' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByRole('textbox', { name: 'List production starts through time' })).toHaveValue('00:05')
  expect(screen.getByRole('slider', { name: /Construction \/ production/ })).toHaveValue('5')
  fireEvent.mouseDown(tab, { button: 0, ctrlKey: false })
  expect(screen.getByRole('slider', { name: 'Statistics timestamp' })).toHaveValue('5')
})

describe('large recorded build orders', () => {
  it('jumps to individual start/finish times and shares editable time with the list', async () => {
    const user = userEvent.setup()
    const { slider } = mount({ includeFinish: true })
    fireEvent.click(screen.getByRole('button', { name: 'Set time to start 00:01' }))
    expect(slider).toHaveValue('1')
    expect(mapCount()).toBe(1)
    expect(screen.getByText('List through 00:01.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Set time to finish 01:01' }))
    expect(slider).toHaveValue('61.5')
    expect(mapCount()).toBe(61)
    await user.click(screen.getByRole('tab', { name: 'List' }))
    const input = screen.getByRole('textbox', { name: 'List production starts through time' })
    expect(input).toHaveValue('01:01')
    fireEvent.change(input, { target: { value: '1:30' } })
    fireEvent.blur(input)
    expect(slider).toHaveValue('90')
    expect(mapCount()).toBe(90)
  })

  it('makes both ends of grouped time ranges clickable', () => {
    const { slider } = mount({ summarize: true, includeFinish: true })
    fireEvent.click(screen.getByRole('button', { name: 'Set time to finish 134:20' }))
    expect(slider).toHaveValue('8060.5')
    expect(mapCount()).toBe(8000)
    fireEvent.click(screen.getByRole('button', { name: 'Set time to start 133:20' }))
    expect(slider).toHaveValue('8000')
    fireEvent.click(screen.getByRole('button', { name: 'Set time to finish 01:01' }))
    expect(slider).toHaveValue('61.5')
    fireEvent.click(screen.getByRole('button', { name: 'Set time to start 00:01' }))
    expect(slider).toHaveValue('1')
    expect(mapCount()).toBe(1)
  })

  it('never rerenders the table or rebuilds map data during an 8,000-record drag', () => {
    const { table, slider } = mount({ summarize: true, diverse: true })
    const calls = vi.mocked(useReactTable).mock.calls.length
    const placements = vi.mocked(CanvasPlacements).mock.lastCall![0].placements
    fireEvent.pointerDown(slider)
    for (const value of [6000, 6500, 7000, 7900, 3000, 4000]) {
      fireEvent.change(slider, { target: { value } })
      expect(slider).toHaveValue(String(value))
      expect(mapCount()).toBe(value)
      expect(vi.mocked(useReactTable).mock.calls).toHaveLength(calls)
      expect(vi.mocked(CanvasPlacements).mock.lastCall![0].placements).toBe(placements)
      expect(table).toHaveAttribute('aria-rowcount', '201')
    }
    expect(screen.getByText(/the map is live; the list updates on release/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export filtered CSV' })).toBeDisabled()
    fireEvent.pointerUp(window)
    expect(vi.mocked(useReactTable).mock.calls.length).toBeGreaterThan(calls)
    expect(screen.getByText('Page 1 / 20')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export filtered CSV' })).toBeEnabled()
  })

  it('windows the list while filtering, selecting and exporting all 8,000 records', async () => {
    const download = vi.spyOn(utils, 'download').mockImplementation(() => {})
    const { list, table, slider } = mount()
    expect(screen.getByText(/8000 of 8000 records/)).toBeInTheDocument()
    expect(screen.getByText('Page 1 / 40')).toBeInTheDocument()
    expect(mapCount()).toBe(8000)
    expect(table).toHaveAttribute('aria-rowcount', '201')
    expect(within(table).getAllByRole('row').length).toBeLessThan(30)
    expect(
      screen.queryByRole('checkbox', {
        name: 'Select Wind Turbine (Alice, Unit 101) for map',
      }),
    ).not.toBeInTheDocument()

    fireEvent.scroll(list, { target: { scrollTop: 57 * 100 } })
    const selected = screen.getByRole('checkbox', {
      name: 'Select Wind Turbine (Alice, Unit 101) for map',
    })
    fireEvent.click(selected)
    expect(mapCount()).toBe(1)
    expect(within(table).getAllByRole('row').length).toBeLessThan(30)

    fireEvent.change(slider, { target: { value: 100 } })
    expect(slider).toHaveValue('100')
    await waitFor(() => expect(mapCount()).toBe(0))
    expect(screen.getByText(/100 of 8000 records/)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('Page 1 / 1')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Export filtered CSV' }))
    expect(parseRecording(download.mock.calls[0][0])).toHaveLength(100)

    act(() => {
      for (const value of [8000, 200, 6000, 0, 8000])
        fireEvent.change(slider, { target: { value } })
    })
    await waitFor(() => expect(mapCount()).toBe(1))
    expect(slider).toHaveValue('8000')
    expect(screen.getByText(/8000 of 8000 records/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear map selection' }))
    expect(mapCount()).toBe(8000)

    act(() => {
      for (const value of [200, 7000, 0])
        fireEvent.change(slider, { target: { value } })
    })
    await waitFor(() => expect(mapCount()).toBe(0))
    expect(screen.getByText(/0 of 8000 records/)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('No matching records.')).toBeInTheDocument())
  })

  it('windows an expanded 8,000-record constructor group and retains offscreen selections', () => {
    const { list, table } = mount({ summarize: true, byConstructor: true })
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'Select all filtered builds by Bot #9000 (Alice) for map',
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: /8000 × Wind Turbine/ }))
    expect(table).toHaveAttribute('aria-rowcount', '8003')
    expect(within(table).getAllByRole('row').length).toBeLessThan(30)

    fireEvent.scroll(list, { target: { scrollTop: 57 * 7990 } })
    const last = screen.getByRole('checkbox', {
      name: 'Select Wind Turbine (Alice, Unit 8000) for map',
    })
    expect(last).toBeChecked()
    fireEvent.click(last)
    expect(mapCount()).toBe(7999)
    expect(within(table).getAllByRole('row').length).toBeLessThan(30)

    fireEvent.scroll(list, { target: { scrollTop: 0 } })
    expect(
      screen.getByRole('checkbox', {
        name: 'Select all filtered builds by Bot #9000 (Alice) for map',
      }),
    ).toBePartiallyChecked()
  })
})
