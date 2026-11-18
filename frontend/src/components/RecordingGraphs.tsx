import { useEffect, useMemo, useRef } from 'react'
import {
  Chart, Legend, LineController, LineElement, LinearScale, PointElement, Tooltip,
} from 'chart.js'
import type { Recording } from '@/lib/schemas'
import { graphMetrics, groupAlliedGraphSeries, recordingGraphSeries, type GraphPoint, type GraphSeries } from '@/lib/recording-graphs'
import { timeLabel } from '@/lib/replays'
import { Combobox } from './ui/combobox'

Chart.register(Legend, LineController, LineElement, LinearScale, PointElement, Tooltip)

function AlliedSideChart({
  series, label, metric, maximum, minimumValue, maximumValue,
}: {
  series: GraphSeries[]
  label: string
  metric: string
  maximum: number
  minimumValue: number
  maximumValue: number
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!canvas.current) return
    const chart = new Chart<'line', GraphPoint[]>(canvas.current, {
      type: 'line',
      data: {
        datasets: series.map(({ team, points, known }) => {
          const color = colors[team.team_id] ?? `hsl(${(team.team_id * 137.508) % 360}, 70%, 65%)`
          return {
            label: team.player,
            data: points,
            borderColor: color,
            backgroundColor: color,
            borderWidth: 2,
            pointRadius: known === 1 ? 3 : 0,
            pointHoverRadius: 4,
            spanGaps: false,
          }
        }),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        parsing: false,
        interaction: { mode: 'nearest', intersect: false },
        scales: {
          x: {
            type: 'linear', min: 0, max: Math.max(1, maximum),
            title: { display: true, text: 'Game time', color: '#9ca3af' },
            ticks: { color: '#9ca3af', callback: (value) => timeLabel(Number(value)) },
            grid: { color: '#263244' },
          },
          y: {
            type: 'linear', min: minimumValue, suggestedMax: maximumValue,
            title: { display: true, text: metric, color: '#9ca3af' },
            ticks: { color: '#9ca3af' },
            grid: { color: '#263244' },
          },
        },
        plugins: {
          legend: { labels: { color: '#9ca3af' } },
          tooltip: {
            callbacks: {
              title: (items) => items.length ? `${label} · ${timeLabel(items[0].parsed.x ?? 0)}` : label,
            },
          },
        },
      },
    })
    return () => chart.destroy()
  }, [series, metric, label, maximum, minimumValue, maximumValue])
  return (
    <div className="relative h-72">
      <canvas ref={canvas} role="img" aria-label={`${label}: ${metric}, full recorded history`}>
        {label}: {metric} across the full recorded game.
      </canvas>
    </div>
  )
}

const colors = ['#e6bc6a', '#60a5fa', '#34d399', '#f87171', '#c084fc', '#22d3ee']

export function RecordingGraphs({
  recording, metricId, onMetricChange,
}: {
  recording: Recording
  metricId: string
  onMetricChange: (id: string) => void
}) {
  const stats = recording.statistics
  const metric = graphMetrics.find((m) => m.id === metricId) ?? graphMetrics[0]
  const series = useMemo(() => stats ? recordingGraphSeries(stats, metric) : [], [stats, metric])
  const groups = useMemo(() => groupAlliedGraphSeries(series), [series])
  const range = useMemo(() => {
    let min = 0
    let max = 0
    for (const { points } of series) {
      for (const { y } of points) {
        if (y === null) continue
        min = Math.min(min, y)
        max = Math.max(max, y)
      }
    }
    return { min, max: max + (max - min || 1) * 0.05 }
  }, [series])
  return (
    <section aria-label="Recording graphs" className="space-y-4">
      <div className="panel flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h4 className="font-semibold">Full-game graphs</h4>
          <p className="muted">
            One graph per allied side, with a separate line for each player-controlled team, across the full recorded history.
            The selected timestamp and recording filters do not limit these graphs.
          </p>
        </div>
        <div className="w-full max-w-sm">
          <Combobox label="Graph statistic" value={metric.label}
            empty="Default: metal production"
            options={graphMetrics.map((m) => m.label)}
            onChange={(label) => onMetricChange(graphMetrics.find((m) => m.label === label)?.id ?? graphMetrics[0].id)} />
        </div>
      </div>
      {!stats ? (
        <p role="status" className="panel text-sm text-primary">
          History: Not recorded. Replay with the updated widget and import _statistics.json to show graphs.
        </p>
      ) : (
        <>
          <p className="muted">
            {recording.statistics_filename} · {timeLabel(stats.started_frame / stats.game_speed)}–{timeLabel(stats.export_frame / stats.game_speed)}
            {' '}· Snapshots every {stats.sample_period_frames / stats.game_speed}s.
            All graphs use the same time and value scales. Missing values and skipped intervals remain gaps, not zeroes.
            Income/production includes reclaim unless explicitly excluded. Force value is metal + energy ÷ 60, not combat strength.
            Player values are shown separately, not summed. Teams without a recorded allied side have separate graphs.
            Co-op controllers of a shared army share its line.
            {(!stats.full_replay_captured || !stats.game_over) && ' Warning: partial capture; this is all recorded history, not necessarily the whole match.'}
            {stats.truncated && ' Warning: statistics size limit reached; later history is missing.'}
          </p>
          <div className="recording-graphs-grid">
            {groups.map((group) => (
              <article className="panel space-y-3" key={group.id} aria-label={`${group.label} graph`}>
                <div>
                  <h5 className="font-semibold">{group.label}</h5>
                  <p className="muted">
                    {group.series.map(({ team }) => team.player).join(', ')}
                    {' '}· {metric.label}
                  </p>
                </div>
                {group.series.some(({ known }) => known > 0) && (
                  <AlliedSideChart series={group.series} label={group.label} metric={metric.label}
                    maximum={stats.export_frame / stats.game_speed}
                    minimumValue={range.min} maximumValue={range.max} />
                )}
                {group.series.map(({ team, points, known }) => (
                  <p className="muted" key={team.team_id}>
                    {team.player}: {known
                      ? <>{known} recorded values · {timeLabel(points[0].x)}–{timeLabel(points.at(-1)!.x)}</>
                      : 'Not recorded for this team.'}
                  </p>
                ))}
              </article>
            ))}
          </div>
          {!series.length && <p className="panel muted">No team history was recorded.</p>}
        </>
      )}
    </section>
  )
}
