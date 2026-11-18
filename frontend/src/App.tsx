import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { ArrowLeft, BookOpen, Download, Plus, RefreshCw } from 'lucide-react'
import { useLibrary } from '@/hooks/use-library'
import {
  dateLabel,
  localDate,
  mapName,
  playerName,
  playersFor,
  rankedFor,
  teamsFor,
  timeLabel,
} from '@/lib/replays'
import { cn, errorMessage } from '@/lib/utils'
import { AddReplayDialog } from './components/AddReplayDialog'
import { AssetStatus } from './components/AssetStatus'
import { ConfirmDialog } from './components/ConfirmDialog'
import { PlayerMenu } from './components/PlayerMenu'
import type { RecordingPreferences } from './components/RecordedBuildOrder'
import { Button } from './components/ui/button'
import { Combobox } from './components/ui/combobox'
import { Input } from './components/ui/input'
import { Label } from './components/ui/label'

const emptyFilters = {
  search: '',
  player: '',
  faction: '',
  map: '',
  type: '',
  ranked: '',
  from: '',
  to: '',
}
const ReplayDetail = lazy(() =>
  import('./components/ReplayDetail').then((module) => ({
    default: module.ReplayDetail,
  })),
)
export function App() {
  const library = useLibrary()
  const [filters, setFilters] = useState({ ...emptyFilters, ranked: 'Ranked' })
  const [sort, setSort] = useState('newest')
  const [selected, setSelected] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null)
  const [preferences, setPreferences] = useState<RecordingPreferences>({
    kind: '',
    summarize: true,
    view: 'timeline',
  })
  const [notice, setNotice] = useState('')
  const [editorRevision, setEditorRevision] = useState(0)
  const libraryPosition = useRef<{
    x: number
    y: number
    focus: HTMLElement | null
  } | null>(null)
  const entries = library.entries.data
  const all = useMemo(() => Object.entries(entries || {}), [entries])
  const names = [
    ...new Set(
      all.flatMap(([, entry]) => playersFor(entry.bar_api).map(playerName)),
    ),
  ].sort()
  const maps = [
    ...new Set(all.map(([, entry]) => mapName(entry.bar_api))),
  ].sort()
  const types = [
    ...new Set(all.map(([, entry]) => entry.bar_api.preset || 'Unclassified')),
  ].sort()
  const factions = [
    ...new Set(
      all.flatMap(([, entry]) =>
        playersFor(entry.bar_api)
          .filter((p) => playerName(p) === filters.player)
          .map((p) => p.faction || '')
          .filter(Boolean),
      ),
    ),
  ].sort()
  const onFilter = useCallback(
    (name: string) => {
      const action = () => {
        setFilters((previous) => ({ ...previous, player: name, faction: '' }))
        setSelected(null)
      }
      if (dirty) setPendingAction(() => action)
      else action()
    },
    [dirty],
  )
  const guard = (action: () => void) => {
    if (dirty) setPendingAction(() => action)
    else action()
  }
  const select = (url: string) => {
    if (selected !== url)
      guard(() => {
        setDirty(false)
        openDetails(url)
      })
  }
  const openDetails = (url: string) => {
    libraryPosition.current = {
      x: window.scrollX,
      y: window.scrollY,
      focus:
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null,
    }
    setSelected(url)
  }
  const closeDetails = () =>
    guard(() => {
      setDirty(false)
      setSelected(null)
    })
  useEffect(() => {
    if (selected) {
      window.scrollTo(0, 0)
      document
        .querySelector<HTMLButtonElement>('[data-back-to-library]')
        ?.focus({ preventScroll: true })
    } else if (libraryPosition.current) {
      const { x, y, focus } = libraryPosition.current
      window.scrollTo(x, y)
      if (focus?.isConnected) focus.focus({ preventScroll: true })
      else
        document
          .getElementById('library-search')
          ?.focus({ preventScroll: true })
      libraryPosition.current = null
    }
  }, [selected])
  const clear = () => {
    setFilters(emptyFilters)
    setSort('newest')
  }
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [dirty])
  useEffect(() => {
    if (selected && entries && !entries[selected]) {
      setSelected(null)
      setDirty(false)
    }
  }, [entries, selected])
  const visible = all
    .filter(([url, entry]) => {
      const api = entry.bar_api,
        players = playersFor(api),
        date = localDate(api.startTime)
      if (filters.ranked && rankedFor(api) !== filters.ranked) return false
      if (filters.map && mapName(api) !== filters.map) return false
      if (
        filters.player &&
        !players.some(
          (p) =>
            playerName(p) === filters.player &&
            (!filters.faction || p.faction === filters.faction),
        )
      )
        return false
      if (filters.type && (api.preset || 'Unclassified') !== filters.type)
        return false
      if (filters.from && (!date || date < filters.from)) return false
      if (filters.to && (!date || date > filters.to)) return false
      const haystack = [
        url,
        entry.remarks,
        entry.build_order,
        mapName(api),
        api.preset,
        ...players.flatMap((p) => [p.name, p.faction]),
        ...(api.Spectators || []).map((p) => p.name),
      ]
        .join(' ')
        .toLocaleLowerCase()
      return haystack.includes(filters.search.trim().toLocaleLowerCase())
    })
    .sort(([urlA, a], [urlB, b]) => {
      const time = (value?: string | null) =>
        new Date(value || '').getTime() || 0
      const delta =
        sort === 'oldest'
          ? time(a.bar_api.startTime) - time(b.bar_api.startTime)
          : sort === 'longest'
            ? (b.bar_api.durationMs || 0) - (a.bar_api.durationMs || 0)
            : sort === 'shortest'
              ? (a.bar_api.durationMs || 0) - (b.bar_api.durationMs || 0)
              : sort === 'map'
                ? mapName(a.bar_api).localeCompare(mapName(b.bar_api))
                : sort === 'map-desc'
                  ? mapName(b.bar_api).localeCompare(mapName(a.bar_api))
                  : time(b.bar_api.startTime) - time(a.bar_api.startTime)
      return delta || urlA.localeCompare(urlB)
    })
  return (
    <div
      className={cn(
        'app-shell flex flex-col',
        selected ? 'h-dvh overflow-hidden' : 'min-h-dvh',
      )}
    >
      <header
        className={cn(
          'flex shrink-0 flex-wrap items-center justify-between gap-3 border-b bg-card px-4 sm:px-6',
          selected ? 'py-2' : 'py-4',
        )}
      >
        {selected ? (
          <Button
            variant="ghost"
            size="sm"
            data-back-to-library
            onClick={closeDetails}
          >
            <ArrowLeft />
            Back to library
          </Button>
        ) : (
          <div className="flex items-center gap-3">
            <BookOpen className="size-7 text-primary" />
            <div>
              <h1 className="text-lg font-semibold tracking-tight">
                BAR Build Order Library
              </h1>
              <p className="text-xs text-muted-foreground">
                Local replay archive & opening notebook
              </p>
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {selected && (
            <Button
              variant="outline"
              size="sm"
              disabled={library.refreshAssets.isPending}
              onClick={() => library.refreshAssets.mutate()}
            >
              <RefreshCw
                className={cn(
                  library.refreshAssets.isPending && 'animate-spin',
                )}
              />
              <span className="sr-only sm:not-sr-only">
                {library.refreshAssets.isPending
                  ? 'Downloading assets…'
                  : 'Refresh assets'}
              </span>
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={library.entries.isFetching}
            onClick={() =>
              guard(() => {
                void library
                  .reload()
                  .then(() => setEditorRevision((n) => n + 1))
              })
            }
          >
            <RefreshCw
              className={cn(library.entries.isFetching && 'animate-spin')}
            />
            <span className={cn(selected && 'sr-only sm:not-sr-only')}>
              Reload
            </span>
          </Button>
          <Button
            asChild
            variant="outline"
            size="sm"
            className={cn(selected && 'hidden sm:inline-flex')}
          >
            <a href="/api/export" download>
              <Download />
              Export JSON
            </a>
          </Button>
          <Button
            size="sm"
            className={cn(selected && 'hidden sm:inline-flex')}
            onClick={() => guard(() => setAddOpen(true))}
          >
            <Plus />
            Add replay
          </Button>
        </div>
      </header>
      <div
        className={cn(
          'library-layout grid flex-1',
          selected
            ? 'min-h-0 overflow-hidden'
            : 'items-start lg:grid-cols-[270px_minmax(0,1fr)]',
        )}
      >
        <aside
          hidden={!!selected}
          className="border-b bg-card/50 lg:self-stretch lg:border-b-0 lg:border-r"
        >
          <div className="space-y-5 p-4 lg:sticky lg:top-0 lg:max-h-dvh lg:overflow-y-auto">
            <div className="flex justify-between text-sm">
              <span>
                <strong className="text-primary">{all.length}</strong> replays
              </span>
              <span>{maps.length} maps</span>
              <span>{names.length} players</span>
            </div>
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Library filters
              </h2>
              <Button variant="ghost" size="sm" onClick={clear}>
                Clear all
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-1">
              <div className="field col-span-2 lg:col-span-1">
                <Label htmlFor="library-search">Search library</Label>
                <Input
                  id="library-search"
                  value={filters.search}
                  onChange={(e) =>
                    setFilters({ ...filters, search: e.target.value })
                  }
                  placeholder="Players, notes, map…"
                />
              </div>
              <Combobox
                label="Ranked status"
                value={filters.ranked}
                options={['Ranked', 'Unranked']}
                onChange={(ranked) => setFilters({ ...filters, ranked })}
              />
              <Combobox
                label="Player"
                value={filters.player}
                options={names}
                onChange={onFilter}
              />
              <Combobox
                label="Faction"
                value={filters.faction}
                options={factions}
                disabled={!filters.player}
                onChange={(faction) => setFilters({ ...filters, faction })}
              />
              <Combobox
                label="Map"
                value={filters.map}
                options={maps}
                onChange={(map) => setFilters({ ...filters, map })}
              />
              <Combobox
                label="Game type"
                value={filters.type}
                options={types}
                onChange={(type) => setFilters({ ...filters, type })}
              />
              <div className="field">
                <Label htmlFor="date-from">From date</Label>
                <Input
                  id="date-from"
                  type="date"
                  value={filters.from}
                  onChange={(e) =>
                    setFilters({ ...filters, from: e.target.value })
                  }
                />
              </div>
              <div className="field">
                <Label htmlFor="date-to">To date</Label>
                <Input
                  id="date-to"
                  type="date"
                  value={filters.to}
                  onChange={(e) =>
                    setFilters({ ...filters, to: e.target.value })
                  }
                />
              </div>
            </div>
            <div className="border-t pt-4">
              <AssetStatus library={library} />
            </div>
            <div className="space-y-2 border-t pt-4">
              <p className="text-xs text-muted-foreground">
                SQLite storage · local only
              </p>
              {library.status.data && (
                <>
                  <p className="break-all text-xs text-muted-foreground">
                    {library.status.data.database_path}
                  </p>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(
                          library.status.data!.database_path,
                        )
                        setNotice('Database path copied.')
                      } catch {
                        setNotice(
                          'Clipboard unavailable. Copy the displayed path manually.',
                        )
                      }
                    }}
                  >
                    Copy database path
                  </Button>
                </>
              )}
              {library.status.error && (
                <p role="alert" className="text-xs text-destructive">
                  {errorMessage(library.status.error)}
                </p>
              )}
            </div>
          </div>
        </aside>
        <main
          className={cn('replay-main min-w-0', selected && 'h-full min-h-0')}
        >
          <section
            hidden={!!selected}
            className="space-y-4 p-4 sm:p-6"
            aria-label="Replay library"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-medium">
                {visible.length} of {all.length} replays
              </h2>
              <select
                aria-label="Sort replays"
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                className="rounded-md border bg-background p-2 text-sm"
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="longest">Longest first</option>
                <option value="shortest">Shortest first</option>
                <option value="map">Map name A–Z</option>
                <option value="map-desc">Map name Z–A</option>
              </select>
            </div>
            {library.entries.isPending && (
              <p role="status" className="panel muted">
                Loading your replay library…
              </p>
            )}
            {library.entries.error && (
              <div role="alert" className="panel space-y-3">
                <p className="text-destructive">
                  {errorMessage(library.entries.error)}
                </p>
                <Button
                  variant="outline"
                  onClick={() => void library.entries.refetch()}
                >
                  Retry
                </Button>
              </div>
            )}
            {library.entries.isSuccess && !visible.length && (
              <div className="panel space-y-3 py-10 text-center">
                <h3 className="text-lg font-semibold">
                  {all.length ? 'No matching replays' : 'Your library is empty'}
                </h3>
                <p className="muted">
                  {all.length
                    ? 'Try changing your filters.'
                    : 'Add a replay to save its match data and study its opening.'}
                </p>
                <Button
                  onClick={() => (all.length ? clear() : setAddOpen(true))}
                >
                  {all.length ? 'Clear filters' : 'Add first replay'}
                </Button>
              </div>
            )}
            <div className="grid gap-3 2xl:grid-cols-2">
              {visible.map(([url, entry]) => (
                <article
                  key={url}
                  className={cn(
                    'panel space-y-3 transition-colors hover:border-primary/50',
                    selected === url && 'border-primary bg-primary/5',
                  )}
                >
                  <button
                    className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => select(url)}
                    aria-pressed={selected === url}
                    aria-label={`View ${mapName(entry.bar_api)} replay`}
                  >
                    <h3 className="font-semibold">
                      {mapName(entry.bar_api)}{' '}
                      <span className="float-right text-primary">›</span>
                    </h3>
                    <p className="muted mt-1">
                      {dateLabel(entry.bar_api.startTime)}
                    </p>
                  </button>
                  <p className="text-xs text-primary">
                    {entry.bar_api.preset || 'Unclassified'} ·{' '}
                    {entry.bar_api.durationMs
                      ? timeLabel(entry.bar_api.durationMs / 1000)
                      : '—'}{' '}
                    · {playersFor(entry.bar_api).length} players{' '}
                    {entry.recorded_build_order && '· Recorded build order'}
                  </p>
                  <div className="space-y-1 text-sm">
                    {teamsFor(entry.bar_api).map((team, index) => (
                      <div key={index} className="flex flex-wrap gap-x-2">
                        <span className="text-muted-foreground">
                          T{index + 1}
                          {team.winningTeam ? ' ★' : ''}
                        </span>
                        {(team.Players || []).map((player, i) => (
                          <PlayerMenu
                            key={i}
                            name={playerName(player)}
                            onFilter={onFilter}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                  {(entry.build_order || entry.remarks) && (
                    <p className="line-clamp-2 border-t pt-2 text-sm text-muted-foreground">
                      {entry.build_order || entry.remarks}
                    </p>
                  )}
                </article>
              ))}
            </div>
          </section>
          {selected && entries?.[selected] && (
            <div className="replay-workspace">
              <Suspense fallback={<p role="status">Loading replay details…</p>}>
                <ReplayDetail
                  key={`${selected}:${editorRevision}`}
                  url={selected}
                  entry={entries[selected]}
                  library={library}
                  onDirty={setDirty}
                  onClose={closeDetails}
                  onFilter={onFilter}
                  preferences={preferences}
                  setPreferences={setPreferences}
                />
              </Suspense>
            </div>
          )}
        </main>
      </div>
      {notice && (
        <div
          role="status"
          className="fixed bottom-4 right-4 max-w-sm rounded-lg border bg-card p-4 shadow-xl"
          onClick={() => setNotice('')}
        >
          {notice}
        </div>
      )}
      <AddReplayDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        library={library}
        onCreated={(url) => {
          clear()
          setDirty(false)
          openDetails(url)
        }}
      />
      <ConfirmDialog
        open={pendingAction !== null}
        onOpenChange={(open) => {
          if (!open) setPendingAction(null)
        }}
        title="Discard unsaved notes?"
        description="Your unsaved remarks and manual build-order changes will be lost."
        onConfirm={() => {
          setDirty(false)
          setEditorRevision((n) => n + 1)
          pendingAction?.()
          setPendingAction(null)
        }}
      />
    </div>
  )
}
