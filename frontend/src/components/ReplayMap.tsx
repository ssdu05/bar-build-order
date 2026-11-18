import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Maximize2, Minimize2 } from 'lucide-react'
import type { Library } from '@/hooks/use-library'
import { useMapExpansion } from '@/hooks/use-map-expansion'
import { cn } from '@/lib/utils'
import {
  buildTimeColors,
  buildTimeGradient,
  buildTimeRange,
  unknownBuildTimeColor,
} from '@/lib/build-time-colors'
import {
  completed,
  eventSeconds,
  internalName,
  numeric,
  resolvedName,
  type BuildRow,
} from '@/lib/recording'
import {
  colorFor,
  dimensionsFor,
  idFor,
  playerName,
  playersFor,
  teamsFor,
  timeLabel,
} from '@/lib/replays'
import type { Recording, Replay } from '@/lib/schemas'
import {
  useRecordingTime,
  type RecordingTimeline,
} from '@/lib/recording-timeline'
import {
  createPlacementIndex,
  placementAtTime,
  placementClusterZoom,
} from '@/lib/placement-clusters'
import {
  placementAt,
  mapFit,
  type MapBounds,
  type MapView,
  type Placement,
} from '@/lib/placement-scene'
import { Button } from './ui/button'
import { PlayerMenu } from './PlayerMenu'
import { CanvasPlacements } from './CanvasPlacements'

type View = MapView
type Bounds = MapBounds
const initialView: View = { x: 0, y: 0, zoom: 1 }
const palette = [
  '#75bbf7',
  '#ffb86c',
  '#acdb84',
  '#d6a5ff',
  '#ff9fae',
  '#88e1da',
]

export function UnitIcon({
  name,
  version,
  label = '',
}: {
  name: string
  version: number
  label?: string
}) {
  const [failed, setFailed] = useState('')
  const source = name
    ? `/api/assets/units/${name}?v=${version}`
    : '/unit-placeholder.svg'
  return (
    <img
      src={source === failed ? '/unit-placeholder.svg' : source}
      onError={() => setFailed(source)}
      alt={label}
      width={32}
      height={32}
      className="size-8 shrink-0 rounded bg-background object-contain"
    />
  )
}

export function ReplayMap({
  api,
  url,
  version,
  rows,
  allRows,
  recording,
  onFilter,
  fit = false,
  timeControl,
  timeline,
}: {
  api: Replay
  url: string
  version: number
  rows?: BuildRow[]
  allRows?: BuildRow[]
  recording?: Recording | null
  onFilter: (name: string) => void
  fit?: boolean
  timeControl?: ReactNode
  timeline?: RecordingTimeline
}) {
  const cutoff = useRecordingTime(timeline)
  const dimensions = dimensionsFor(api)
  const bounds: Bounds = useMemo(() => {
    if (dimensions) return { ...dimensions, x: 0, y: 0 }
    const points = (allRows || []).flatMap((row) => {
      const x = numeric(row.x),
        y = numeric(row.z)
      return x !== null && y !== null && x >= 0 && y >= 0 ? [{ x, y }] : []
    })
    if (!points.length) return { x: 0, y: 0, width: 840, height: 440 }
    let minX = Infinity,
      minY = Infinity,
      maxX = 0,
      maxY = 0
    for (const p of points) {
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x)
      maxY = Math.max(maxY, p.y)
    }
    const width = Math.max(100, maxX - minX),
      height = Math.max(100, maxY - minY)
    return {
      x: minX - width * 0.05,
      y: minY - height * 0.05,
      width: width * 1.1,
      height: height * 1.1,
    }
  }, [dimensions?.width, dimensions?.height, allRows])
  const [view, setView] = useState<View>({
    ...initialView,
    x: bounds.x,
    y: bounds.y,
  })
  const [showSpawns, setShowSpawns] = useState(true)
  const [colorByTime, setColorByTime] = useState(false)
  const [clusterNearby, setClusterNearby] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const root = useRef<HTMLElement>(null)
  const expandButton = useRef<HTMLButtonElement>(null)
  const collapse = useCallback(() => setExpanded(false), [])
  useMapExpansion(expanded, root, expandButton, collapse)
  const [hover, setHover] = useState<{
    placement: Placement
    x: number
    y: number
  } | null>(null)
  const svg = useRef<SVGSVGElement>(null)
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const node = svg.current!
    const measure = () => {
      const { width, height } = node.getBoundingClientRect()
      setStageSize((previous) =>
        previous.width === width && previous.height === height
          ? previous
          : { width, height },
      )
    }
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    measure()
    return () => observer.disconnect()
  }, [])
  const pendingView = useRef<View | null>(null)
  const viewFrame = useRef<number | null>(null)
  const scheduleView = (next: View) => {
    pendingView.current = next
    setHover(null)
    if (viewFrame.current === null)
      viewFrame.current = requestAnimationFrame(() => {
        viewFrame.current = null
        if (pendingView.current) setView(pendingView.current)
        pendingView.current = null
      })
  }
  useEffect(
    () => () => {
      if (viewFrame.current !== null) cancelAnimationFrame(viewFrame.current)
    },
    [],
  )
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<{
    center: { x: number; y: number }
    distance: number
    view: View
  } | null>(null)
  const [failedImage, setFailedImage] = useState('')
  const imageUrl = `/api/entries/${idFor(url)}/map-image?v=${version}`
  const normalize = (x: number, y: number) => {
    const rect = svg.current!.getBoundingClientRect()
    const fitted = mapFit(bounds, rect.width, rect.height)
    return {
      x: (x - rect.left - fitted.left) / fitted.width,
      y: (y - rect.top - fitted.top) / fitted.height,
    }
  }
  const clamp = (v: View): View => ({
    zoom: v.zoom,
    x: Math.max(
      bounds.x,
      Math.min(v.x, bounds.x + bounds.width - bounds.width / v.zoom),
    ),
    y: Math.max(
      bounds.y,
      Math.min(v.y, bounds.y + bounds.height - bounds.height / v.zoom),
    ),
  })
  const zoomAt = (factor: number, point = { x: 0.5, y: 0.5 }) => {
    const v = pendingView.current || view
    const zoom = Math.max(1, Math.min(16, v.zoom * factor))
    scheduleView(
      clamp({
        zoom,
        x: v.x + bounds.width * point.x * (1 / v.zoom - 1 / zoom),
        y: v.y + bounds.height * point.y * (1 / v.zoom - 1 / zoom),
      }),
    )
  }
  const wheel = useEffectEvent((e: WheelEvent) => {
    // The overview is a page, not a map workspace: don't trap normal scrolling.
    if (!rows && !e.ctrlKey && !e.metaKey) return
    e.preventDefault()
    zoomAt(
      Math.exp(-Math.max(-100, Math.min(100, e.deltaY)) * 0.008),
      normalize(e.clientX, e.clientY),
    )
  })
  useEffect(() => {
    const node = svg.current!
    node.addEventListener('wheel', wheel, { passive: false })
    return () => node.removeEventListener('wheel', wheel)
  }, [])
  useEffect(() => {
    if (viewFrame.current !== null) cancelAnimationFrame(viewFrame.current)
    viewFrame.current = null
    pendingView.current = null
    setView({ zoom: 1, x: bounds.x, y: bounds.y })
    setHover(null)
  }, [bounds.width, bounds.height, bounds.x, bounds.y])
  const reset = () => scheduleView({ zoom: 1, x: bounds.x, y: bounds.y })
  const startGesture = () => {
    const [a, b = a] = [...pointers.current.values()]
    gesture.current = a
      ? {
          center: normalize((a.x + b.x) / 2, (a.y + b.y) / 2),
          distance: Math.hypot(a.x - b.x, a.y - b.y),
          view: pendingView.current || view,
        }
      : null
  }
  const release = (id: number) => {
    pointers.current.delete(id)
    startGesture()
  }
  // Spawn numbers need to stay legible in the concise overview. Recorded
  // placement icons and their original sizing are unchanged.
  const radius = Math.min(bounds.width, bounds.height) * (rows ? 0.018 : 0.04)
  const players = useMemo(() => playersFor(api), [api])
  const spawns = players.flatMap((player, i) => {
    const x = player.startPos?.x,
      z = player.startPos?.z
    return dimensions &&
      typeof x === 'number' &&
      typeof z === 'number' &&
      x >= 0 &&
      z >= 0 &&
      x <= dimensions.width &&
      z <= dimensions.height
      ? [{ player, x, z, number: i + 1 }]
      : []
  })
  const timedRows = useMemo(
    () => (rows || []).map((row) => ({ row, seconds: eventSeconds(row) })),
    [rows],
  )
  const locatedRows = useMemo(
    () =>
      timedRows.flatMap(({ row, seconds }) => {
        const x = numeric(row.x),
          z = numeric(row.z)
        if (
          x === null ||
          z === null ||
          x < 0 ||
          z < 0 ||
          (dimensions && (x > dimensions.width || z > dimensions.height))
        )
          return []
        return [{ row, x, z, seconds }]
      }),
    [timedRows, dimensions?.width, dimensions?.height],
  )
  const placementCache = useMemo(
    () => new WeakMap<BuildRow, Placement>(),
    [recording, players, version],
  )
  const placements = useMemo<Placement[]>(() => {
    const colors = new Map(players.map((p) => [String(p.teamId), colorFor(p)]))
    return locatedRows.map(({ row, x, z, seconds }) => {
      const color =
        colors.get(row.team_id) ||
        palette[Math.abs(Number(row.team_id) || 0) % palette.length]
      const previous = placementCache.get(row)
      if (previous?.color === color) return previous
      if (previous) {
        const placement = { ...previous, color }
        placementCache.set(row, placement)
        return placement
      }
      const name = internalName(row, recording)
      const label = resolvedName(row, recording)
      const placement = {
        key: row.key,
        x,
        z,
        seconds,
        color,
        icon: name
          ? `/api/assets/units/${name}?v=${version}`
          : '/unit-placeholder.svg',
        label: `${row.start_time} ${row.player}: ${label} (${row.status})`,
        description: `${row.player}: ${label} · ${row.start_time} · ${completed(row) ? 'Completed' : 'Not completed'} · X ${x}, Z ${z}`,
      }
      placementCache.set(row, placement)
      return placement
    })
  }, [locatedRows, recording, players, version, placementCache])
  const visiblePlacements = useMemo(
    () => placements.filter((placement) => (placement.seconds ?? 0) <= cutoff),
    [placements, cutoff],
  )
  const clusterIndex = useMemo(
    () => clusterNearby && placements.length > 1
      ? createPlacementIndex(placements, bounds)
      : null,
    [clusterNearby, placements, bounds],
  )
  const clusterZoom = placementClusterZoom(
    bounds, view.zoom, stageSize.width, stageSize.height,
  )
  const measured = stageSize.width > 0 && stageSize.height > 0
  const mapPlacements = useMemo(
    () => clusterIndex && measured
      ? clusterIndex.atZoom(clusterZoom)
      : placements,
    [clusterIndex, clusterZoom, measured, placements],
  )
  const displayedPlacements = useMemo(
    () => mapPlacements.flatMap((placement) => {
      const point = placementAtTime(placement, cutoff)
      if (!point) return []
      if (point.single) return [point.single]
      return [{
        ...placement,
        x: point.x,
        z: point.z,
        label: `${point.count} nearby build records`,
        description: `${point.count} nearby build records. Zoom in, filter, or select records in the build-order list for individual details.`,
      }]
    }),
    [mapPlacements, cutoff],
  )
  const visibleRecords = useMemo(
    () => timedRows.reduce(
      (count, { seconds }) => count + Number((seconds ?? 0) <= cutoff),
      0,
    ),
    [timedRows, cutoff],
  )
  const timeScale = useMemo(
    () => colorByTime
      ? buildTimeRange(visiblePlacements.map((placement) => placement.seconds ?? null))
      : null,
    [colorByTime, visiblePlacements],
  )
  useEffect(() => setHover(null), [mapPlacements, cutoff])
  return (
    <section
      ref={root}
      className={cn(
        'replay-map',
        fit && 'replay-map--fit',
        expanded && 'replay-map--expanded',
      )}
      role={expanded ? 'dialog' : undefined}
      aria-modal={expanded || undefined}
      aria-label={
        expanded
          ? 'Expanded recorded map'
          : rows
            ? 'Recorded placements'
            : 'Replay map'
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          aria-label="Zoom out"
          disabled={view.zoom <= 1}
          onClick={() => zoomAt(1 / 1.5)}
        >
          −
        </Button>
        <Button
          variant="outline"
          size="sm"
          aria-label="Zoom in"
          disabled={view.zoom >= 16}
          onClick={() => zoomAt(1.5)}
        >
          +
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={reset}
          aria-label="Reset map"
        >
          {rows ? 'Reset' : 'Reset map'}
        </Button>
        <span className="muted">{Math.round(view.zoom * 100)}%</span>
        {rows && (
          <>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                aria-label="Color outlines by build time"
                checked={colorByTime}
                onChange={(e) => setColorByTime(e.target.checked)}
              />
              Build-time colors
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                aria-label="Cluster nearby placements"
                checked={clusterNearby}
                onChange={(event) => setClusterNearby(event.target.checked)}
              />
              Cluster nearby icons
            </label>
            <label className="ml-auto flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                aria-label="Show player spawns & starting boxes"
                checked={showSpawns}
                onChange={(e) => setShowSpawns(e.target.checked)}
              />
              Spawns & boxes
            </label>
          </>
        )}
        {rows && (
          <Button
            ref={expandButton}
            size="sm"
            variant="outline"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <Minimize2 /> : <Maximize2 />}
            {expanded ? 'Exit expanded map' : 'Expand map'}
          </Button>
        )}
      </div>
      {timeControl}
      {timeScale && (
        <div
          role="group"
          aria-label="Build time color legend"
          className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm"
        >
          {timeScale.first !== null && timeScale.last !== null ? (
            timeScale.first === timeScale.last ? (
              <span className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="size-3 rounded-sm"
                  style={{ background: buildTimeColors[1] }}
                />
                All timed placements: {timeLabel(timeScale.first)}
              </span>
            ) : (
              <>
                <span>Earlier · {timeLabel(timeScale.first)}</span>
                <span
                  aria-hidden="true"
                  className="h-3 w-32 rounded-sm"
                  style={{ background: buildTimeGradient }}
                />
                <span>Later · {timeLabel(timeScale.last)}</span>
              </>
            )
          ) : (
            <span>No known build times in the current map selection.</span>
          )}
          {timeScale.unknown > 0 && (
            <span className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="size-3 rounded-sm"
                style={{ background: unknownBuildTimeColor }}
              />
              Unknown time · {timeScale.unknown}
            </span>
          )}
          <span className="muted">
            Relative to the current map selection and filters.
            {clusterNearby && ' Cluster badges use their latest known start.'}
          </span>
        </div>
      )}
      <div
        className="replay-map-stage"
        style={{
          aspectRatio:
            fit || expanded ? undefined : `${bounds.width}/${bounds.height}`,
        }}
      >
        <svg
          ref={svg}
          role="group"
          aria-label={`${rows ? 'Build placements on' : 'Player spawns on'} ${api.Map?.scriptName || 'map'}`}
          aria-description={`${rows ? 'Scroll' : 'Ctrl / Cmd + scroll'} or pinch to zoom; drag to pan. Plus, minus, arrow keys and Home also work.${rows ? ` ${visiblePlacements.length} build placements in ${displayedPlacements.length} map ${displayedPlacements.length === 1 ? 'marker' : 'markers'}. Hover for details, or use the build-order list for accessible record details and selection.` : ''}`}
          tabIndex={0}
          className={cn(
            'block size-full rounded-md border bg-background outline-none focus-visible:ring-2 focus-visible:ring-ring',
            rows ? 'touch-none' : 'touch-pan-y',
          )}
          viewBox={`${view.x} ${view.y} ${bounds.width / view.zoom} ${bounds.height / view.zoom}`}
          onDoubleClick={(e) => zoomAt(2, normalize(e.clientX, e.clientY))}
          onPointerDown={(e) => {
            if (e.button !== 0) return
            setHover(null)
            pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
            e.currentTarget.setPointerCapture(e.pointerId)
            startGesture()
          }}
          onPointerMove={(e) => {
            if (!pointers.current.has(e.pointerId) || !gesture.current) {
              if (!rows || e.pointerType === 'touch') return
              const point = normalize(e.clientX, e.clientY)
              const placement = placementAt(
                displayedPlacements,
                bounds,
                view,
                view.x + (point.x * bounds.width) / view.zoom,
                view.y + (point.y * bounds.height) / view.zoom,
              )
              const rect = svg.current!.getBoundingClientRect()
              setHover(
                placement
                  ? {
                      placement,
                      x: e.clientX - rect.left,
                      y: e.clientY - rect.top,
                    }
                  : null,
              )
              return
            }
            pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
            if (!rows && e.pointerType === 'touch' && pointers.current.size < 2)
              return
            const [a, b = a] = [...pointers.current.values()],
              g = gesture.current
            const center = normalize((a.x + b.x) / 2, (a.y + b.y) / 2)
            const zoom = g.distance
              ? Math.max(
                  1,
                  Math.min(
                    16,
                    (g.view.zoom * Math.hypot(a.x - b.x, a.y - b.y)) /
                      g.distance,
                  ),
                )
              : g.view.zoom
            scheduleView(
              clamp({
                zoom,
                x:
                  g.view.x +
                  (bounds.width / g.view.zoom) * g.center.x -
                  (bounds.width / zoom) * center.x,
                y:
                  g.view.y +
                  (bounds.height / g.view.zoom) * g.center.y -
                  (bounds.height / zoom) * center.y,
              }),
            )
          }}
          onPointerLeave={() => setHover(null)}
          onPointerUp={(e) => release(e.pointerId)}
          onPointerCancel={(e) => release(e.pointerId)}
          onLostPointerCapture={(e) => release(e.pointerId)}
          onKeyDown={(e) => {
            if (['+', '='].includes(e.key)) zoomAt(1.5)
            else if (e.key === '-') zoomAt(1 / 1.5)
            else if (['Home', '0'].includes(e.key)) reset()
            else if (
              ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(
                e.key,
              )
            ) {
              const v = pendingView.current || view
              scheduleView(
                clamp({
                  ...v,
                  x:
                    v.x +
                    ((e.key === 'ArrowLeft'
                      ? -0.15
                      : e.key === 'ArrowRight'
                        ? 0.15
                        : 0) *
                      bounds.width) /
                      v.zoom,
                  y:
                    v.y +
                    ((e.key === 'ArrowUp'
                      ? -0.15
                      : e.key === 'ArrowDown'
                        ? 0.15
                        : 0) *
                      bounds.height) /
                      v.zoom,
                }),
              )
            } else return
            e.preventDefault()
          }}
        >
          {api.Map?.fileName &&
            (!rows || dimensions) &&
            imageUrl !== failedImage && (
              <image
                href={imageUrl}
                x={0}
                y={0}
                width={bounds.width}
                height={bounds.height}
                preserveAspectRatio="none"
                onError={() => setFailedImage(imageUrl)}
              />
            )}
          {dimensions && showSpawns && (
            <>
              {teamsFor(api).map((team, i) => {
                const b = team.startBox
                return b &&
                  [b.left, b.top, b.right, b.bottom].every(
                    (n) => n >= 0 && n <= 1,
                  ) &&
                  b.right > b.left &&
                  b.bottom > b.top ? (
                  <rect
                    key={i}
                    x={b.left * bounds.width}
                    y={b.top * bounds.height}
                    width={(b.right - b.left) * bounds.width}
                    height={(b.bottom - b.top) * bounds.height}
                    fill={palette[i % palette.length]}
                    fillOpacity={0.12}
                    stroke={palette[i % palette.length]}
                    strokeWidth={radius / 5}
                  />
                ) : null
              })}
              {spawns.map(({ player, x, z, number }) => (
                <g
                  key={number}
                  transform={`translate(${x} ${z}) scale(${1 / view.zoom})`}
                  tabIndex={0}
                  role="img"
                  aria-label={`${number}. ${playerName(player)}`}
                >
                  <title>
                    {playerName(player)} · {player.faction}
                  </title>
                  <circle
                    r={radius}
                    fill={colorFor(player)}
                    stroke="white"
                    strokeWidth={radius / 7}
                  />
                  <text
                    dy=".35em"
                    textAnchor="middle"
                    fontSize={radius * 1.35}
                    fontWeight="bold"
                    fill="white"
                    stroke="#101823"
                    strokeWidth={radius / 8}
                    paintOrder="stroke"
                  >
                    {number}
                  </text>
                </g>
              ))}
            </>
          )}
        </svg>
        {rows && (
          <CanvasPlacements
            placements={mapPlacements}
            bounds={bounds}
            view={view}
            version={version}
            timeline={timeline}
            colorByTime={colorByTime}
          />
        )}
        {hover && (
          <div
            role="tooltip"
            className="pointer-events-none absolute z-10 max-w-full rounded border bg-popover p-2 text-xs text-popover-foreground shadow-md"
            style={{
              left:
                hover.x > (svg.current?.clientWidth || 0) / 2
                  ? undefined
                  : hover.x + 12,
              right:
                hover.x > (svg.current?.clientWidth || 0) / 2
                  ? (svg.current?.clientWidth || 0) - hover.x + 12
                  : undefined,
              top: hover.y,
            }}
          >
            {hover.placement.description}
          </div>
        )}
      </div>
      <p
        className={cn(
          'replay-map-help muted',
          (!dimensions ||
            failedImage === imageUrl ||
            (rows && visibleRecords !== visiblePlacements.length)) &&
            'replay-map-warning',
        )}
      >
        {!dimensions
          ? 'Map dimensions unavailable; placements use a relative X/Z plot. '
          : ''}
        {failedImage === imageUrl
          ? 'Map image unavailable locally; use Refresh assets. '
          : ''}
        {rows
          ? 'Scroll / pinch to zoom · Drag to pan.'
          : 'Ctrl / Cmd + scroll or pinch to zoom · Drag to pan.'}
        {rows &&
          ` Production-start positions, not unit movement. ${visibleRecords - visiblePlacements.length} records have missing or out-of-map coordinates.`}
        {rows && clusterNearby && ' Nearby records use count badges; zoom in to separate them.'}
      </p>
      {showSpawns && (
        <ul className="replay-map-players flex flex-wrap gap-x-4 gap-y-2 text-sm">
          {spawns.map(({ player, number }) => (
            <li key={number}>
              <span style={{ color: colorFor(player) }}>{number}. </span>
              <PlayerMenu name={playerName(player)} onFilter={onFilter} />{' '}
              {player.faction}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export const assetVersion = (library: Library) => library.assets.dataUpdatedAt
