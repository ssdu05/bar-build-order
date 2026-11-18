import {
  lazy,
  Suspense,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getFilteredRowModel,
  getGroupedRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type AggregationFn,
  type ColumnFiltersState,
  type ExpandedState,
  type FilterFn,
  type Row,
  type SortingState,
} from '@tanstack/react-table'
import type { Library } from '@/hooks/use-library'
import {
  completed,
  constructorBuilds,
  eventSeconds,
  exportRecording,
  internalName,
  parseRecording,
  readImport,
  recordingWarnings,
  resolvedName,
  type BuildRow,
} from '@/lib/recording'
import { timeLabel } from '@/lib/replays'
import {
  createRecordingTimeline,
  useRecordingTime,
  type RecordingTimeline,
} from '@/lib/recording-timeline'
import { matchesRecordingFilter } from '@/lib/recording-filters'
import type { Entry, Recording } from '@/lib/schemas'
import { cn, download, errorMessage } from '@/lib/utils'
import { AssetStatus } from './AssetStatus'
import { ConfirmDialog } from './ConfirmDialog'
import { PlayerMenu } from './PlayerMenu'
import { assetVersion, ReplayMap, UnitIcon } from './ReplayMap'
import { RecordingTimeControl } from './RecordingTimeControl'
import { RecordingStatistics } from './RecordingStatistics'
import { statisticsMaximum } from '@/lib/recording-statistics'
import { Button } from './ui/button'
import { Combobox } from './ui/combobox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from './ui/dialog'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './ui/table'

const RecordingGraphs = lazy(() =>
  import('./RecordingGraphs').then((module) => ({ default: module.RecordingGraphs })),
)

export type RecordingPreferences = {
  kind: string
  summarize: boolean
  view: 'timeline' | 'constructor'
}

export function RecordedBuildOrder({
  entry,
  url,
  library,
  onFilter,
  preferences,
  setPreferences,
}: {
  entry: Entry
  url: string
  library: Library
  onFilter: (name: string) => void
  preferences: RecordingPreferences
  setPreferences: (value: RecordingPreferences) => void
}) {
  const recording = entry.recorded_build_order
  const parsed = useMemo(() => {
    try {
      return { rows: recording ? parseRecording(recording.csv) : [], error: '' }
    } catch (error) {
      return { rows: [], error: errorMessage(error) }
    }
  }, [recording?.csv])
  const [error, setError] = useState('')
  const [reading, setReading] = useState(false)
  const [candidate, setCandidate] = useState<Recording | null>(null)
  const [issues, setIssues] = useState<string[]>([])
  const [remove, setRemove] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const busy = reading || library.saveRecording.isPending
  const persist = async (next: Recording | null) => {
    setError('')
    try {
      await library.saveRecording.mutateAsync({ url, recording: next })
      setCandidate(null)
      setRemove(false)
      setImportOpen(false)
    } catch (err) {
      setError(`Existing recording kept. ${errorMessage(err)}`)
    }
  }
  const importFile = async (file?: File) => {
    if (!file || busy) return
    setReading(true)
    setError('')
    try {
      const next = await readImport(file, recording)
      const warnings = recordingWarnings(
        next,
        parseRecording(next.csv),
        entry.bar_api,
      )
      if (warnings.length) {
        setIssues(warnings)
        setCandidate(next)
      } else await persist(next)
    } catch (err) {
      setError(`Import failed; existing recording kept. ${errorMessage(err)}`)
    } finally {
      setReading(false)
    }
  }
  const warnings = recording
    ? recordingWarnings(recording, parsed.rows, entry.bar_api)
    : []
  const summary = recording?.summary
  return (
    <div className="recorded-build-order">
      <div
        className="recording-source panel"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          void importFile(e.dataTransfer.files[0])
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="hidden font-semibold sm:block">
            Recorded build order
          </h3>
          <div className="flex gap-2">
            {recording && (
              <Button
                size="sm"
                variant="ghost"
                aria-expanded={showDetails}
                onClick={() => setShowDetails(!showDetails)}
              >
                Recording details
              </Button>
            )}
            <Button
              size="sm"
              disabled={busy}
              onClick={() => setImportOpen(true)}
            >
              Import files
            </Button>
          </div>
        </div>
        <p className="muted" hidden={!!recording && !showDetails}>
          {recording
            ? `Saved locally: ${recording.filename}`
            : 'Drop a RealBO CSV here, or import files to attach a recording.'}{' '}
          Original CSV and metadata are stored locally.
        </p>
        {busy && <p role="status">Validating and saving recording…</p>}
        {(error || parsed.error) && (
          <p role="alert" className="text-sm text-destructive">
            {error || parsed.error}
          </p>
        )}
        {recording && (
          <div className="flex flex-wrap gap-2" hidden={!showDetails}>
            {recording.unit_map && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void persist({
                    ...recording,
                    unit_map: null,
                    unit_map_filename: '',
                  })
                }
              >
                Remove unit mapping
              </Button>
            )}
            {summary && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void persist({
                    ...recording,
                    summary: null,
                    summary_filename: '',
                  })
                }
              >
                Remove summary
              </Button>
            )}
            {recording.statistics && (
              <Button size="sm" variant="outline" disabled={busy}
                onClick={() => void persist({ ...recording, statistics: null, statistics_filename: '' })}>
                Remove statistics
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => setRemove(true)}
            >
              Remove recording
            </Button>
          </div>
        )}
      </div>
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent>
          <DialogTitle>Import recording files</DialogTitle>
          <DialogDescription>
            Import the widget’s complete CSV first. Replacing it clears its
            previous summary, unit mapping and statistics. JSON files are identified
            automatically. No files are sent to BAR.
          </DialogDescription>
          <Label htmlFor="recording-file">
            Recording CSV or statistics (10 MiB), unit definitions (5 MiB), or summary (1 MiB)
          </Label>
          <Input
            id="recording-file"
            type="file"
            accept=".csv,.json"
            disabled={busy}
            onChange={(e) => {
              void importFile(e.target.files?.[0])
              e.target.value = ''
            }}
          />
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={candidate !== null}
        onOpenChange={(open) => {
          if (!open) setCandidate(null)
        }}
        title="Recording metadata does not match"
        error={error}
        description={`${issues.join('\n')}\n\nAttach these files anyway?`}
        busy={library.saveRecording.isPending}
        onConfirm={() => {
          if (candidate) void persist(candidate)
        }}
      />
      <ConfirmDialog
        open={remove}
        onOpenChange={setRemove}
        title="Remove recording?"
        error={error}
        description="This removes the CSV, summary, unit definitions and statistics. Manual notes and the replay snapshot are kept."
        destructive
        busy={library.saveRecording.isPending}
        onConfirm={() => void persist(null)}
      />
      {recording && !parsed.error && (
        <>
          <div
            className="recording-capture panel space-y-2 text-sm"
            hidden={!showDetails}
          >
            <p
              className={
                warnings.length ||
                !summary?.full_replay_captured ||
                !summary.game_over
                  ? 'text-primary'
                  : 'text-green-300'
              }
            >
              Replay fully captured:{' '}
              {!summary || warnings.length
                ? 'Unknown'
                : summary.full_replay_captured && summary.game_over
                  ? 'Yes, according to the recorder'
                  : 'No — incomplete capture'}
              . Full observer visibility is still required.
            </p>
            {summary ? (
              <>
                <p>
                  {summary.counts.started} starts · {summary.counts.buildings}{' '}
                  buildings · {summary.counts.units} units ·{' '}
                  {summary.counts.completed} completed ·{' '}
                  {summary.counts.unfinished} unfinished ·{' '}
                  {summary.counts.removed_before_completion} removed before
                  completion.
                </p>
                <p className="muted">
                  {recording.summary_filename} · Exported {summary.export_time}{' '}
                  · Frames {summary.started_frame}–{summary.export_frame}
                </p>
                {(!summary.game_over ||
                  !summary.full_replay_captured ||
                  summary.skipped_frames ||
                  summary.rewind_detected ||
                  summary.started_frame > 0) && (
                  <p className="text-primary">
                    Capture warning:{' '}
                    {!summary.game_over && 'exported before game-over. '}
                    {summary.started_frame > 0 && 'Recording started late. '}
                    {summary.skipped_frames && 'Frames were skipped. '}
                    {summary.rewind_detected && 'Replay was rewound. '}
                    {!summary.full_replay_captured && 'Not fully captured.'}
                  </p>
                )}
              </>
            ) : (
              <p className="muted">
                Import _summary.json to check capture completeness.
              </p>
            )}
            {recording.unit_map && (
              <p className="muted">
                Names resolved by UnitDef ID from {recording.unit_map_filename}.{' '}
                {
                  parsed.rows.filter(
                    (row) => recording.unit_map?.units[row.unit_def_id],
                  ).length
                }{' '}
                of {parsed.rows.length} rows matched.
              </p>
            )}
            {warnings.map((warning) => (
              <p key={warning} className="text-primary">
                {warning}
              </p>
            ))}
          </div>
          <BuildOrderTable
            rows={parsed.rows}
            recording={recording}
            entry={entry}
            url={url}
            library={library}
            onFilter={onFilter}
            preferences={preferences}
            setPreferences={setPreferences}
          />
        </>
      )}
    </div>
  )
}

type TableRecord = ReturnType<typeof constructorBuilds>[number] & {
  name: string
  seconds: number
  done: string
}
type ListItem =
  | { kind: 'constructor'; row: Row<TableRecord>; builds: TableRecord[] }
  | { kind: 'record'; row: Row<TableRecord> }
const tableHeaderHeight = 48
const firstValue: AggregationFn<TableRecord> = (columnId, leafRows) =>
  leafRows[0]?.getValue(columnId)
const recordingFilter: FilterFn<TableRecord> = (row, id, value) =>
  matchesRecordingFilter(row.original, id, value)

function RecordingSummary({
  timeline,
  rows,
  total,
  exported,
  busy,
}: {
  timeline: RecordingTimeline
  rows: TableRecord[]
  total: number
  exported: BuildRow[]
  busy: boolean
}) {
  const cutoff = useRecordingTime(timeline)
  const visible = rows.filter((row) => row.seconds <= cutoff)
  const pending = cutoff !== timeline.getCommittedSnapshot()
  return (
    <>
      <p className="muted">
        {visible.length} of {total} records ·{' '}
        {visible.filter((row) => row.done === 'Completed').length} completed ·{' '}
        {new Set(visible.map((row) => row.team_id)).size} players
      </p>
      <Button
        variant="outline"
        size="sm"
        disabled={pending || busy}
        onClick={() => download(exportRecording(exported), 'realbo_filtered.csv')}
      >
        Export filtered CSV
      </Button>
    </>
  )
}

function RecordingMapStatus({
  timeline,
  rows,
  selected,
}: {
  timeline: RecordingTimeline
  rows: TableRecord[]
  selected: number
}) {
  const cutoff = useRecordingTime(timeline)
  return (
    <p role="status" className="muted">
      {selected
        ? `Map: ${rows.filter((row) => row.seconds <= cutoff).length} of ${selected} selected records match the current filters.`
        : 'Map: all filtered records.'}
    </p>
  )
}

function RecordingListTime({ timeline }: { timeline: RecordingTimeline }) {
  const cutoff = useRecordingTime(timeline)
  return (
    <p role="status" className="muted px-3">
      {cutoff !== timeline.getCommittedSnapshot()
        ? 'Scrubbing — the map is live; the list updates on release.'
        : `List through ${timeLabel(cutoff)}.`}
    </p>
  )
}
function RecordingTimeRange({
  rows,
  kind,
  timeline,
}: {
  rows: TableRecord[]
  kind: 'start' | 'finish'
  timeline: RecordingTimeline
}) {
  const values = rows
    .map((row) => eventSeconds(row, kind))
    .filter((v): v is number => v !== null)
  let min = Infinity,
    max = -Infinity
  for (const value of values) {
    min = Math.min(min, value)
    max = Math.max(max, value)
  }
  const timeButton = (seconds: number) => (
    <button
      type="button"
      className="rounded-sm text-primary underline decoration-dotted underline-offset-4 hover:decoration-solid focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`Set time to ${kind} ${timeLabel(seconds)}`}
      onClick={() => {
        timeline.preview(seconds)
        timeline.commit()
      }}
    >
      {timeLabel(seconds)}
    </button>
  )
  return (
    <>
      {!values.length ? '—' : min === max ? timeButton(min) : (
        <>
          {timeButton(min)}–{timeButton(max)}
        </>
      )}
      {values.length < rows.length && ` (${rows.length - values.length} unknown)`}
    </>
  )
}

function MapSelectionCheckbox({
  rows,
  selected,
  label,
  onChange,
}: {
  rows: BuildRow[]
  selected: Set<string>
  label: string
  onChange: (rows: BuildRow[], checked: boolean) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const count = rows.reduce(
    (total, row) => total + Number(selected.has(row.key)),
    0,
  )
  const mixed = count > 0 && count < rows.length
  useEffect(() => {
    if (input.current) input.current.indeterminate = mixed
  }, [mixed])
  return (
    <input
      ref={input}
      type="checkbox"
      aria-label={label}
      title={label}
      checked={rows.length > 0 && count === rows.length}
      disabled={!rows.length}
      onChange={(event) => onChange(rows, event.target.checked)}
      className="size-4 shrink-0 accent-primary"
    />
  )
}

export function BuildOrderTable({
  rows,
  recording,
  entry,
  url,
  library,
  onFilter,
  preferences,
  setPreferences,
}: {
  rows: BuildRow[]
  recording: Recording
  entry: Entry
  url: string
  library: Library
  onFilter: (name: string) => void
  preferences: RecordingPreferences
  setPreferences: (value: RecordingPreferences) => void
}) {
  const [filters, setFilters] = useState<ColumnFiltersState>([])
  // Text filters can be deferred, but time preview never enters table state.
  const deferredFilters = useDeferredValue(filters)
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'seconds', desc: false },
  ])
  const [expanded, setExpanded] = useState<ExpandedState>({})
  const [pane, setPane] = useState('map')
  const [view, setView] = useState('builds')
  const [graphMetric, setGraphMetric] = useState('metalIncome')
  const [showFilters, setShowFilters] = useState(false)
  const [showList, setShowList] = useState(true)
  const [selection, setSelection] = useState({
    rows,
    url,
    keys: new Set<string>(),
  })
  // Scope by the source recording, not display groups, sorting, or filters.
  const selected = useMemo(
    () =>
      selection.rows === rows && selection.url === url
        ? selection.keys
        : new Set<string>(),
    [selection, rows, url],
  )
  const selectRows = (builds: BuildRow[], checked: boolean) =>
    setSelection((previous) => {
      const keys = new Set(
        previous.rows === rows && previous.url === url ? previous.keys : [],
      )
      for (const row of builds) {
        if (checked) keys.add(row.key)
        else keys.delete(row.key)
      }
      return { rows, url, keys }
    })
  const byConstructor = preferences.view === 'constructor'
  const grouping = useMemo(
    () =>
      preferences.summarize ? [byConstructor ? 'constructorRun' : 'run'] : [],
    [preferences.summarize, byConstructor],
  )
  const tableSorting = useMemo(
    () =>
      byConstructor
        ? [{ id: 'constructorOrder', desc: false }, ...sorting]
        : sorting,
    [byConstructor, sorting],
  )
  const nonTimeFilters = useMemo(
    () => [
      ...deferredFilters,
      ...(preferences.kind
        ? [{ id: 'unit_kind', value: preferences.kind }]
        : []),
    ],
    [deferredFilters, preferences.kind],
  )
  const data = useMemo(
    () =>
      constructorBuilds(rows).map((row) => ({
        ...row,
        name: resolvedName(row, recording),
        seconds: eventSeconds(row) ?? 0,
        done: completed(row) ? 'Completed' : 'Not completed',
      })),
    [rows, recording],
  )
  const maximum = useMemo(
    () => statisticsMaximum(recording, rows),
    [rows, recording.statistics, recording.summary],
  )
  const timeline = useMemo(
    () => createRecordingTimeline(maximum),
    [rows, url, maximum],
  )
  useEffect(() => () => timeline.dispose(), [timeline])
  const committedCutoff = useSyncExternalStore(
    timeline.subscribeCommit,
    timeline.getCommittedSnapshot,
  )
  const columnFilters = useMemo(
    () => [
      ...nonTimeFilters,
      ...(committedCutoff < maximum
        ? [{ id: 'seconds', value: committedCutoff }]
        : []),
    ],
    [nonTimeFilters, committedCutoff, maximum],
  )
  const previewRows = useMemo(
    () => nonTimeFilters.length
      ? data.filter((row) =>
          nonTimeFilters.every(({ id, value }) =>
            matchesRecordingFilter(row, id, value),
          ),
        )
      : data,
    [data, nonTimeFilters],
  )
  const version = assetVersion(library)
  const columns = useMemo<ColumnDef<TableRecord>[]>(
    () => [
      { accessorKey: 'run', enableSorting: false },
      { accessorKey: 'constructorRun', enableSorting: false },
      {
        accessorKey: 'constructorOrder',
        aggregationFn: firstValue,
        sortingFn: 'basic',
      },
      { accessorKey: 'unit_kind', filterFn: recordingFilter },
      { accessorKey: 'done', filterFn: recordingFilter },
      {
        accessorKey: 'seconds',
        header: 'Start',
        aggregationFn: 'min',
        sortingFn: 'basic',
        filterFn: recordingFilter,
        cell: ({ row }) => (
          <RecordingTimeRange
            rows={[row.original]}
            kind="start"
            timeline={timeline}
          />
        ),
        aggregatedCell: ({ row }) => (
          <RecordingTimeRange
            rows={row.getLeafRows().map((item) => item.original)}
            kind="start"
            timeline={timeline}
          />
        ),
      },
      {
        id: 'finish',
        header: 'Finish',
        aggregationFn: 'max',
        sortingFn: 'basic',
        accessorFn: (row) => eventSeconds(row, 'finish'),
        cell: ({ row }) => (
          <RecordingTimeRange
            rows={[row.original]}
            kind="finish"
            timeline={timeline}
          />
        ),
        aggregatedCell: ({ row }) => (
          <RecordingTimeRange
            rows={row.getLeafRows().map((item) => item.original)}
            kind="finish"
            timeline={timeline}
          />
        ),
      },
      {
        accessorKey: 'player',
        header: 'Player',
        aggregationFn: firstValue,
        filterFn: recordingFilter,
        cell: ({ row }) => (
          <PlayerMenu
            name={row.original.player || 'Unknown'}
            onFilter={onFilter}
          />
        ),
        aggregatedCell: ({ row }) => (
          <PlayerMenu
            name={row.original.player || 'Unknown'}
            onFilter={onFilter}
          />
        ),
      },
      {
        accessorKey: 'name',
        header: 'Building / unit',
        aggregationFn: firstValue,
        filterFn: recordingFilter,
        cell: ({ row }) => {
          const child = (row.getParentRow()?.getLeafRows().length ?? 0) > 1
          return (
            <span
              className={cn(
                'flex items-center gap-2',
                child && 'ml-6 text-primary',
              )}
            >
              {child && <span aria-hidden="true">↳</span>}
              <UnitIcon
                name={internalName(row.original, recording)}
                version={version}
              />
              {row.original.name}
            </span>
          )
        },
        aggregatedCell: ({ row }) => (
          <span className="flex items-center gap-2">
            <UnitIcon
              name={internalName(row.original, recording)}
              version={version}
            />
            <Button
              size="sm"
              variant="ghost"
              className="h-auto whitespace-normal text-left text-primary hover:text-primary"
              aria-expanded={row.getIsExpanded()}
              onClick={row.getToggleExpandedHandler()}
            >
              {row.getIsExpanded() ? '−' : '+'} {row.getLeafRows().length} ×{' '}
              {row.original.name}
            </Button>
          </span>
        ),
      },
      {
        accessorKey: 'status',
        header: 'Status',
        aggregationFn: firstValue,
        aggregatedCell: ({ row }) => {
          const counts = new Map<string, number>()
          for (const item of row.getLeafRows())
            counts.set(
              item.original.status,
              (counts.get(item.original.status) || 0) + 1,
            )
          return [...counts]
            .map(([status, count]) => `${count} ${status}`)
            .join(' · ')
        },
      },
      ...['x', 'z', 'unit_def_id', 'unit_id'].map((key) => ({
        accessorKey: key,
        aggregationFn: firstValue,
        header:
          key === 'unit_def_id'
            ? 'UnitDef ID'
            : key === 'unit_id'
              ? 'Unit ID'
              : key.toUpperCase(),
        aggregatedCell: () => '—',
      })),
    ],
    [onFilter, recording, version, timeline],
  )
  const table = useReactTable({
    data,
    columns,
    state: { sorting: tableSorting, expanded, grouping, columnFilters },
    initialState: {
      pagination: { pageSize: 200 },
      columnVisibility: {
        run: false,
        constructorRun: false,
        constructorOrder: false,
        unit_kind: false,
        done: false,
      },
    },
    onSortingChange: (updater) =>
      setSorting((previous) =>
        (typeof updater === 'function' ? updater(previous) : updater).filter(
          (item) => item.id !== 'constructorOrder',
        ),
      ),
    onExpandedChange: setExpanded,
    getRowId: (row) => row.key,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getGroupedRowModel: getGroupedRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    paginateExpandedRows: false,
    groupedColumnMode: false,
    sortDescFirst: false,
    autoResetExpanded: false,
    autoResetPageIndex: false,
  })
  useEffect(() => {
    table.setPageIndex(0)
    setExpanded({})
  }, [data, grouping, table])
  useEffect(() => {
    table.setPageIndex(0)
  }, [committedCutoff, table])
  const filteredModel = table.getFilteredRowModel()
  const filtered = useMemo(
    () => filteredModel.rows.map((row) => row.original),
    [filteredModel],
  )
  const playerOptions = useMemo(
    () => [...new Set(data.map((row) => row.player))].sort(),
    [data],
  )
  const mapRows = useMemo(
    () =>
      selected.size
        ? previewRows.filter((row) => selected.has(row.key))
        : previewRows,
    [previewRows, selected],
  )
  const constructors = useMemo(() => {
    const result = new Map<string, TableRecord[]>()
    if (!byConstructor) return result
    for (const row of filtered) {
      const builds = result.get(row.constructorKey)
      if (builds) builds.push(row)
      else result.set(row.constructorKey, [row])
    }
    return result
  }, [byConstructor, filtered])
  const visibleRows = table.getRowModel().rows
  const listItems = useMemo(() => {
    const items: ListItem[] = []
    for (const [index, row] of visibleRows.entries()) {
      if (
        byConstructor &&
        row.original.constructorKey !==
          visibleRows[index - 1]?.original.constructorKey
      ) {
        const builds = constructors.get(row.original.constructorKey)
        if (builds) items.push({ kind: 'constructor', row, builds })
      }
      items.push({ kind: 'record', row })
    }
    return items
  }, [visibleRows, byConstructor, constructors])
  const listContainer = useRef<HTMLDivElement>(null)
  const listItemKey = useCallback(
    (index: number) => `${listItems[index].kind}:${listItems[index].row.id}`,
    [listItems],
  )
  const virtualizer = useVirtualizer({
    count: listItems.length,
    getScrollElement: () => listContainer.current,
    estimateSize: () => 57,
    getItemKey: listItemKey,
    overscan: 5,
    scrollMargin: tableHeaderHeight,
  })
  const virtualRows = virtualizer.getVirtualItems()
  const paddingTop = virtualRows.length
    ? virtualRows[0].start - tableHeaderHeight
    : 0
  const paddingBottom = virtualRows.length
    ? virtualizer.getTotalSize() -
      virtualRows[virtualRows.length - 1].end +
      tableHeaderHeight
    : 0
  const filter = (id: string) =>
    (filters.find((item) => item.id === id)?.value as string) || ''
  const updateFilter = (id: string, value: unknown) => {
    if (id === 'player') {
      setSelection({ rows, url, keys: new Set<string>() })
    }
    setFilters((previous) => [
      ...previous.filter((item) => item.id !== id),
      ...(value === '' ? [] : [{ id, value }]),
    ])
    table.setPageIndex(0)
  }
  return (
    <div
      className="recording-workspace-container"
      data-list-hidden={!showList}
      aria-busy={filters !== deferredFilters}
    >
      <Tabs
        value={view}
        onValueChange={setView}
        className="recording-workspace"
        aria-label="Recording workspace"
      >
        <div className="recording-controls">
          <div className="recording-toolbar">
            <Button
              size="sm"
              variant="outline"
              aria-expanded={showFilters}
              onClick={() => setShowFilters(!showFilters)}
            >
              Recording filters
              {columnFilters.length ? ` (${columnFilters.length})` : ''}
            </Button>
            <RecordingSummary
              timeline={timeline}
              rows={previewRows}
              total={data.length}
              exported={filtered}
              busy={filters !== deferredFilters}
            />
          </div>
          <div className="recording-filters panel" hidden={!showFilters}>
            <Combobox
              label="Recording player"
              value={filter('player')}
              options={playerOptions}
              onChange={(value) => updateFilter('player', value)}
            />
            <Combobox
              label="Construction status"
              value={filter('done')}
              options={['Completed', 'Not completed']}
              onChange={(value) => updateFilter('done', value)}
            />
            <Combobox
              label="Show"
              value={
                preferences.kind === 'building'
                  ? 'Buildings only'
                  : preferences.kind === 'unit'
                    ? 'Units only'
                    : ''
              }
              empty="Buildings & units"
              options={['Buildings only', 'Units only']}
              onChange={(value) => {
                setPreferences({
                  ...preferences,
                  kind:
                    value === 'Buildings only'
                      ? 'building'
                      : value === 'Units only'
                        ? 'unit'
                        : '',
                })
                table.setPageIndex(0)
              }}
            />
            <div className="field">
              <Label htmlFor="build-search">Building / unit name</Label>
              <Input
                id="build-search"
                value={filter('name')}
                onChange={(e) => updateFilter('name', e.target.value)}
                placeholder="Search names…"
              />
            </div>
            <label className="col-span-2 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={preferences.summarize}
                onChange={(e) => {
                  setPreferences({
                    ...preferences,
                    summarize: e.target.checked,
                  })
                  table.setPageIndex(0)
                }}
              />
              Summarise consecutive buildings / units
            </label>
          </div>
          {view === 'builds' && pane === 'list' && (
            <RecordingTimeControl
              timeline={timeline}
              maximum={maximum}
              id="build-time-list"
              label="List production starts through"
              className="recording-list-time field"
            />
          )}
        </div>
        <div className="recording-view-actions">
          <TabsList
            aria-label="Recording views"
          >
            <TabsTrigger value="builds">Map &amp; list</TabsTrigger>
            <TabsTrigger value="statistics">Statistics</TabsTrigger>
            <TabsTrigger value="graphs">Graphs</TabsTrigger>
          </TabsList>
          {view === 'builds' && <Button
            className="recording-list-toggle"
            variant="ghost"
            size="sm"
            aria-expanded={showList}
            onClick={() => setShowList(!showList)}
          >
            {showList ? 'Hide build list' : 'Show build list'}
          </Button>}
        </div>
        <TabsContent
          value="builds"
          forceMount
          hidden={view !== 'builds'}
          className="recording-build-view"
        >
          <Tabs
            value={pane}
            onValueChange={(next) => {
              setPane(next)
              if (next === 'list') setShowList(true)
            }}
            className="recording-build-panels"
            aria-label="Map and list workspace"
          >
            <TabsList aria-label="Recording panels" className="recording-view-tabs">
              <TabsTrigger value="map">Map</TabsTrigger>
              <TabsTrigger value="list">List</TabsTrigger>
            </TabsList>
        <div className="recording-panes">
          <TabsContent
            value="map"
            forceMount
            className="recording-pane recording-map-pane"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <RecordingMapStatus
                timeline={timeline}
                rows={mapRows}
                selected={selected.size}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={!selected.size}
                onClick={() =>
                  setSelection({ rows, url, keys: new Set<string>() })
                }
              >
                Clear map selection
              </Button>
            </div>
            <ReplayMap
              api={entry.bar_api}
              url={url}
              version={version}
              rows={mapRows}
              allRows={rows}
              recording={recording}
              onFilter={onFilter}
              timeline={timeline}
              fit
              timeControl={
                <RecordingTimeControl
                  timeline={timeline}
                  maximum={maximum}
                  id="build-time"
                />
              }
            />
            <details className="recording-map-assets">
              <summary>Map assets</summary>
              <AssetStatus library={library} url={url} />
            </details>
          </TabsContent>
          <TabsContent
            value="list"
            forceMount
            className="recording-pane recording-list-pane"
          >
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-3 pt-3">
              <h4 className="font-semibold">Build-order list</h4>
              <div
                role="group"
                aria-label="Recording view"
                className="flex flex-wrap gap-2"
              >
                {(['timeline', 'constructor'] as const).map((view) => (
                  <Button
                    key={view}
                    size="sm"
                    variant={preferences.view === view ? 'default' : 'outline'}
                    aria-pressed={preferences.view === view}
                    onClick={() => setPreferences({ ...preferences, view })}
                  >
                    {view === 'timeline' ? 'Timeline' : 'By constructor'}
                  </Button>
                ))}
              </div>
            </div>
            <RecordingListTime timeline={timeline} />
            <details className="px-3 text-sm text-muted-foreground">
              <summary className="cursor-pointer">
                About grouping & map selection
              </summary>
              <p className="mt-2">
                {byConstructor
                  ? 'Actual builds by initial constructor / factory, not queued orders or assisting builders. Consecutive builds are grouped per constructor; other constructors do not interrupt them. Missing builder IDs are shown as unknown and are not summarised together.'
                  : 'Groups follow each player’s consecutive builds, even when other players interleave.'}{' '}
                Select rows or groups to show only their filtered records on the
                map. CSV export and list counts still include all filtered
                individual records.
                {byConstructor &&
                  ' Pages count build groups / records; a constructor can continue on the next page.'}
              </p>
            </details>
            <Table
              className="min-w-max [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10 [&_thead]:bg-card"
              aria-rowcount={listItems.length + 1}
              containerProps={{
                ref: listContainer,
                className: 'min-h-0 flex-1 overscroll-contain',
                role: 'region',
                'aria-label': 'Build-order records',
                tabIndex: 0,
              }}
            >
              <TableHeader>
                {table.getHeaderGroups().map((group) => (
                  <TableRow key={group.id}>
                    <TableHead>
                      <MapSelectionCheckbox
                        rows={filtered}
                        selected={selected}
                        label="Select all filtered records for map"
                        onChange={selectRows}
                      />
                    </TableHead>
                    {group.headers.map((header) => (
                      <TableHead
                        key={header.id}
                        aria-sort={
                          header.column.getIsSorted() === 'asc'
                            ? 'ascending'
                            : header.column.getIsSorted() === 'desc'
                              ? 'descending'
                              : undefined
                        }
                      >
                        {header.column.getCanSort() ? (
                          <button
                            type="button"
                            className="flex items-center gap-1"
                            onClick={header.column.getToggleSortingHandler()}
                          >
                            {flexRender(
                              header.column.columnDef.header,
                              header.getContext(),
                            )}{' '}
                            {header.column.getIsSorted() === 'asc'
                              ? '↑'
                              : header.column.getIsSorted() === 'desc'
                                ? '↓'
                                : '↕'}
                          </button>
                        ) : (
                          flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )
                        )}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {paddingTop > 0 && (
                  <TableRow aria-hidden="true">
                    <TableCell
                      colSpan={table.getVisibleLeafColumns().length + 1}
                      style={{ height: paddingTop, padding: 0, border: 0 }}
                    />
                  </TableRow>
                )}
                {virtualRows.map((virtualRow) => {
                  const item = listItems[virtualRow.index]
                  const { row } = item
                  if (item.kind === 'constructor')
                    return (
                      <TableRow
                        key={virtualRow.key}
                        data-index={virtualRow.index}
                        ref={virtualizer.measureElement}
                        aria-rowindex={virtualRow.index + 2}
                        className="bg-muted/50"
                      >
                        <TableCell
                          colSpan={table.getVisibleLeafColumns().length + 1}
                        >
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <MapSelectionCheckbox
                              rows={item.builds}
                              selected={selected}
                              label={`Select all filtered builds by ${row.original.constructorLabel} (${row.original.player || 'Unknown'}) for map`}
                              onChange={selectRows}
                            />
                            <h4 className="font-semibold">
                              {row.original.constructorLabel}
                            </h4>
                            <PlayerMenu
                              name={row.original.player || 'Unknown'}
                              onFilter={onFilter}
                            />
                            <span className="muted">
                              {item.builds.length}{' '}
                              {item.builds.length === 1 ? 'build' : 'builds'}{' '}
                              · Starts{' '}
                              <RecordingTimeRange
                                rows={item.builds}
                                kind="start"
                                timeline={timeline}
                              />
                            </span>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  const multi =
                    row.getIsGrouped() && row.getLeafRows().length > 1
                  // A single-row run is rendered as a regular record, not an expandable group.
                  const display =
                    row.getIsGrouped() && !multi ? row.getLeafRows()[0] : row
                  const selectionRows = multi
                    ? row.getLeafRows().map((item) => item.original)
                    : [display.original]
                  const selectionLabel = multi
                    ? `${selectionRows.length} × ${display.original.name} (${display.original.player || 'Unknown'})`
                    : `${display.original.name} (${display.original.player || 'Unknown'}, ${
                        display.original.unit_id
                          ? `Unit ${display.original.unit_id}`
                          : `record ${Number(display.original.key) + 1}`
                      })`
                  return (
                    <TableRow
                      key={virtualRow.key}
                      data-index={virtualRow.index}
                      ref={virtualizer.measureElement}
                      aria-rowindex={virtualRow.index + 2}
                    >
                      <TableCell>
                        <MapSelectionCheckbox
                          rows={selectionRows}
                          selected={selected}
                          label={`Select ${selectionLabel} for map`}
                          onChange={selectRows}
                        />
                      </TableCell>
                      {display.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id}>
                          {flexRender(
                            multi
                              ? (cell.column.columnDef.aggregatedCell ??
                                  cell.column.columnDef.cell)
                              : cell.column.columnDef.cell,
                            cell.getContext(),
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  )
                })}
                {paddingBottom > 0 && (
                  <TableRow aria-hidden="true">
                    <TableCell
                      colSpan={table.getVisibleLeafColumns().length + 1}
                      style={{ height: paddingBottom, padding: 0, border: 0 }}
                    />
                  </TableRow>
                )}
                {!table.getRowModel().rows.length && (
                  <TableRow>
                    <TableCell
                      colSpan={table.getVisibleLeafColumns().length + 1}
                    >
                      No matching records.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-3 border-t p-3">
              <span className="muted">
                Page {table.getState().pagination.pageIndex + 1} /{' '}
                {Math.max(1, table.getPageCount())}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={!table.getCanPreviousPage()}
                onClick={() => table.previousPage()}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!table.getCanNextPage()}
                onClick={() => table.nextPage()}
              >
                Next
              </Button>
            </div>
          </TabsContent>
        </div>
          </Tabs>
        </TabsContent>
        <TabsContent value="statistics" className="recording-statistics-view">
          <RecordingTimeControl
            timeline={timeline}
            maximum={maximum}
            id="build-time-statistics"
            label="Statistics timestamp"
          />
          <div className="recording-statistics-scroll">
            <RecordingStatistics
              rows={rows}
              countRows={data.filter((row) => nonTimeFilters.every(({ id, value }) =>
                id === 'done' || matchesRecordingFilter(row, id, value)))}
              recording={recording}
              timeline={timeline}
              player={filter('player')}
              onPlayerChange={(value) => updateFilter('player', value)}
              version={version}
            />
          </div>
        </TabsContent>
        <TabsContent value="graphs" className="recording-statistics-view">
          <div className="recording-statistics-scroll">
            <Suspense fallback={<p role="status" className="muted">Loading graphs…</p>}>
              <RecordingGraphs recording={recording} metricId={graphMetric} onMetricChange={setGraphMetric} />
            </Suspense>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
