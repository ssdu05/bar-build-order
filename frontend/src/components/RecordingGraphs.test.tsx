import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { recording } from '@/test/fixtures'
import { statisticsFixture } from '@/test/statistics-fixture'
import { RecordingGraphs } from './RecordingGraphs'

const chart = vi.hoisted(() => ({ create: vi.fn(), destroy: vi.fn() }))
vi.mock('chart.js', () => ({
  Chart: class {
    static register = vi.fn()
    constructor(canvas: HTMLCanvasElement, config: unknown) { chart.create(canvas, config) }
    destroy() { chart.destroy() }
  },
  Legend: {}, LineController: {}, LineElement: {}, LinearScale: {}, PointElement: {}, Tooltip: {},
}))

beforeEach(() => {
  chart.create.mockClear()
  chart.destroy.mockClear()
})

it('plots allied players as separate lines on one graph, with matching axes across sides and cleanup', () => {
  const stats = statisticsFixture()
  stats.teams.push({ ...stats.teams[1], team_id: 2, ally_team_id: 1, player: 'Charlie' })
  const source = { ...recording, statistics: stats }
  const { unmount } = render(<RecordingGraphs recording={source} metricId="metalIncome" onMetricChange={() => {}} />)
  expect(screen.getAllByRole('img')).toHaveLength(2)
  expect(screen.getByRole('article', { name: 'Allied side 1 graph' })).toHaveTextContent('Alice, Bob')
  expect(screen.getByRole('article', { name: 'Allied side 2 graph' })).toHaveTextContent('Charlie')
  expect(chart.create).toHaveBeenCalledTimes(2)
  const first = chart.create.mock.calls[0][1]
  const second = chart.create.mock.calls[1][1]
  expect(first.type).toBe('line')
  expect(first.data.datasets.map((dataset: { label: string }) => dataset.label)).toEqual(['Alice', 'Bob'])
  expect(first.data.datasets[0].data.at(-1)).toEqual({ x: 20, y: 40 })
  expect(first.data.datasets[1].data.at(-1)).toEqual({ x: 10, y: 8 })
  expect(first.data.datasets[0].borderColor).not.toBe(first.data.datasets[1].borderColor)
  expect(first.data.datasets[0].data).toContainEqual({ x: 15, y: null })
  expect(second.data.datasets).toHaveLength(1)
  expect(second.data.datasets[0].label).toBe('Charlie')
  expect(second.data.datasets[0].data.at(-1)).toEqual({ x: 10, y: 8 })
  expect(first.options.scales.x.max).toBe(20)
  expect(second.options.scales.x.max).toBe(20)
  expect(first.options.scales.y).toEqual(second.options.scales.y)
  expect(first.options.animation).toBe(false)
  expect(first.data.datasets[0].spanGaps).toBe(false)
  expect(screen.queryByRole('slider')).not.toBeInTheDocument()
  unmount()
  expect(chart.destroy).toHaveBeenCalledTimes(2)
})

it('switches allied-side charts to the selected metric and does not invent missing values', async () => {
  const user = userEvent.setup()
  const source = { ...recording, statistics: statisticsFixture() }
  function Harness() {
    const [metric, setMetric] = useState('metalIncome')
    return <RecordingGraphs recording={source} metricId={metric} onMetricChange={setMetric} />
  }
  render(<Harness />)
  await user.click(screen.getByRole('combobox', { name: 'Graph statistic' }))
  await user.click(screen.getByRole('option', { name: 'Total metal produced (including reclaim)' }))
  expect(chart.destroy).toHaveBeenCalledTimes(1)
  expect(chart.create).toHaveBeenCalledTimes(2)
  expect(chart.create.mock.lastCall![1].data.datasets[1].data.at(-1)).toEqual({ x: 10, y: 80 })
  await user.click(screen.getByRole('combobox', { name: 'Graph statistic' }))
  await user.click(screen.getByRole('option', { name: 'Energy production /s (including reclaim)' }))
  expect(screen.getAllByRole('img')).toHaveLength(1)
  expect(within(screen.getByRole('article', { name: 'Allied side 1 graph' })).getByText('Bob: Not recorded for this team.')).toBeInTheDocument()
  expect(chart.create.mock.lastCall![1].data.datasets[1].data.every((point: { y: number | null }) => point.y === null)).toBe(true)
})

it('keeps teams with unknown allied sides separate and handles a wholly missing metric', () => {
  const stats = statisticsFixture()
  stats.teams.forEach((team) => { team.ally_team_id = null })
  const source = { ...recording, statistics: stats }
  const { rerender } = render(<RecordingGraphs recording={source} metricId="metalIncome" onMetricChange={() => {}} />)
  expect(screen.getByRole('article', { name: 'Alice graph' })).toBeInTheDocument()
  expect(screen.getByRole('article', { name: 'Bob graph' })).toBeInTheDocument()
  expect(screen.getAllByRole('img')).toHaveLength(2)
  rerender(<RecordingGraphs recording={source} metricId="energyProduced" onMetricChange={() => {}} />)
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
  expect(screen.getAllByText(/Not recorded for this team/)).toHaveLength(2)
  expect(chart.destroy).toHaveBeenCalledTimes(2)
})

it('explains missing, partial, and truncated recordings', () => {
  const { rerender } = render(<RecordingGraphs recording={recording} metricId="metalIncome" onMetricChange={() => {}} />)
  expect(screen.getByRole('status')).toHaveTextContent('import _statistics.json')
  expect(chart.create).not.toHaveBeenCalled()
  const stats = statisticsFixture()
  stats.game_over = false
  stats.truncated = true
  rerender(<RecordingGraphs recording={{ ...recording, statistics: stats }} metricId="metalIncome" onMetricChange={() => {}} />)
  expect(screen.getByText(/Warning: partial capture/)).toHaveTextContent('later history is missing')
})
