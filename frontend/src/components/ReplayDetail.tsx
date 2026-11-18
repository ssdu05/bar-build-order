import { useEffect, useState } from 'react'
import { ExternalLink, MoreHorizontal, Save, Trash2, X } from 'lucide-react'
import * as Dropdown from '@radix-ui/react-dropdown-menu'
import type { Library } from '@/hooks/use-library'
import {
  dateLabel,
  mapName,
  playerName,
  playersFor,
  rankedFor,
  skillFor,
  teamsFor,
  timeLabel,
} from '@/lib/replays'
import type { Entry } from '@/lib/schemas'
import { errorMessage } from '@/lib/utils'
import { AssetStatus } from './AssetStatus'
import { ConfirmDialog } from './ConfirmDialog'
import { PlayerMenu } from './PlayerMenu'
import {
  RecordedBuildOrder,
  type RecordingPreferences,
} from './RecordedBuildOrder'
import { assetVersion, ReplayMap } from './ReplayMap'
import { Button } from './ui/button'
import { Label } from './ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'
import { Textarea } from './ui/textarea'

export function ReplayDetail({
  url,
  entry,
  library,
  onDirty,
  onClose,
  onFilter,
  preferences,
  setPreferences,
}: {
  url: string
  entry: Entry
  library: Library
  onDirty: (dirty: boolean) => void
  onClose: () => void
  onFilter: (name: string) => void
  preferences: RecordingPreferences
  setPreferences: (value: RecordingPreferences) => void
}) {
  const [remarks, setRemarks] = useState(entry.remarks)
  const [buildOrder, setBuildOrder] = useState(entry.build_order)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [tab, setTab] = useState('overview')
  const dirty = remarks !== entry.remarks || buildOrder !== entry.build_order
  const api = entry.bar_api
  const save = async () => {
    if (!dirty || library.saveNotes.isPending) return
    setError('')
    try {
      await library.saveNotes.mutateAsync({
        url,
        remarks,
        build_order: buildOrder,
      })
    } catch (err) {
      setError(errorMessage(err))
    }
  }
  useEffect(() => {
    onDirty(dirty)
  }, [dirty, onDirty])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey || e.metaKey) &&
        e.key === 'Enter' &&
        !document.querySelector('[role="dialog"]')
      ) {
        e.preventDefault()
        void save()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })
  const remove = async () => {
    setError('')
    try {
      await library.remove.mutateAsync(url)
      setDeleteOpen(false)
      onDirty(false)
    } catch (err) {
      setError(errorMessage(err))
      setDeleteOpen(false)
    }
  }
  return (
    <section
      className="replay-detail"
      data-view={tab}
      aria-label="Replay details"
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="mb-1 hidden text-xs font-semibold uppercase tracking-widest text-primary sm:block">
            {api.preset || 'Unclassified'} / {rankedFor(api)}
          </p>
          <h2 className="text-xl font-semibold">{mapName(api)}</h2>
          <p className="muted mt-1">
            {dateLabel(api.startTime)} ·{' '}
            {api.durationMs
              ? timeLabel(api.durationMs / 1000)
              : 'Unknown duration'}{' '}
            · {playersFor(api).length} players
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Dropdown.Root>
            <Dropdown.Trigger asChild>
              <Button size="sm" variant="outline">
                <MoreHorizontal />
                Replay actions
              </Button>
            </Dropdown.Trigger>
            <Dropdown.Portal>
              <Dropdown.Content
                sideOffset={4}
                align="end"
                className="z-50 min-w-40 rounded-md border bg-popover p-1 shadow-lg"
              >
                <Dropdown.Item
                  asChild
                  className="flex items-center gap-2 rounded-sm px-3 py-2 text-sm outline-none focus:bg-accent"
                >
                  <a href={url} target="_blank" rel="noreferrer">
                    <ExternalLink className="size-4" />
                    Open on BAR
                  </a>
                </Dropdown.Item>
                <Dropdown.Item
                  onSelect={() => setDeleteOpen(true)}
                  className="flex cursor-pointer items-center gap-2 rounded-sm px-3 py-2 text-sm text-destructive outline-none focus:bg-accent"
                >
                  <Trash2 className="size-4" />
                  Delete replay
                </Dropdown.Item>
              </Dropdown.Content>
            </Dropdown.Portal>
          </Dropdown.Root>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Close replay details"
            onClick={onClose}
          >
            <X />
          </Button>
        </div>
      </header>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <Tabs value={tab} onValueChange={setTab} className="replay-detail-tabs">
        <TabsList
          aria-label="Replay views"
          className="max-w-full flex-wrap justify-start"
        >
          <TabsTrigger
            value="overview"
            className="px-2 text-xs sm:px-3 sm:text-sm"
          >
            Overview
          </TabsTrigger>
          <TabsTrigger
            value="recorded"
            className="px-2 text-xs sm:px-3 sm:text-sm"
          >
            Recorded build order
          </TabsTrigger>
          <TabsTrigger value="api" className="px-2 text-xs sm:px-3 sm:text-sm">
            API JSON
          </TabsTrigger>
        </TabsList>
        <TabsContent
          value="overview"
          forceMount
          hidden={tab !== 'overview'}
          className="replay-overview"
        >
          <div className="replay-overview-summary">
            <div className="replay-overview-map">
              <ReplayMap
                api={api}
                url={url}
                version={assetVersion(library)}
                onFilter={onFilter}
              />
            </div>
            <div className="replay-overview-info">
              <div className="replay-overview-teams">
                {teamsFor(api).map((team, i) => (
                  <div key={i} className="replay-overview-team panel space-y-3">
                    <h3 className="flex justify-between text-xs font-semibold uppercase tracking-wide">
                      Team {i + 1}
                      <span className="text-primary">
                        {team.winningTeam === true
                          ? '★ Winner'
                          : team.winningTeam === false
                            ? 'Defeat'
                            : ''}
                      </span>
                    </h3>
                    {(team.Players || []).map((player, index) => (
                      <div
                        key={index}
                        className="replay-overview-player text-sm"
                      >
                        <PlayerMenu
                          name={playerName(player)}
                          onFilter={onFilter}
                        />
                        <span
                          className="text-muted-foreground"
                          title={`OpenSkill at replay time${player.skillUncertainty != null ? ` · Uncertainty: ${player.skillUncertainty}` : ''}`}
                        >
                          OS {skillFor(player)}
                        </span>
                        <span>{player.faction}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              <p className="muted">
                {api.Spectators?.length
                  ? `Spectators: ${api.Spectators.map((p) => p.name || 'Unknown').join(', ')}`
                  : 'No spectators listed'}{' '}
                · Ending:{' '}
                {api.gameEndedNormally === true
                  ? 'Normal'
                  : api.gameEndedNormally === false
                    ? 'Other'
                    : 'Unknown'}
              </p>
              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground">
                  Local assets
                </summary>
                <div className="mt-2">
                  <AssetStatus library={library} url={url} />
                </div>
              </details>
            </div>
          </div>
          <form
            className="replay-overview-notes panel space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              void save()
            }}
          >
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="field">
                <Label htmlFor="remarks">Remarks</Label>
                <Textarea
                  id="remarks"
                  value={remarks}
                  maxLength={200_000}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="What is worth learning from this replay?"
                />
              </div>
              <div className="field">
                <Label htmlFor="build-order">Manual build order</Label>
                <Textarea
                  id="build-order"
                  value={buildOrder}
                  maxLength={200_000}
                  onChange={(e) => setBuildOrder(e.target.value)}
                  placeholder="2 mex → solar → bot lab"
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span role="status" className="muted">
                {dirty ? 'Unsaved changes' : 'All changes saved'} · Ctrl / Cmd +
                Enter to save
              </span>
              <Button
                type="submit"
                disabled={!dirty || library.saveNotes.isPending}
              >
                <Save />
                {library.saveNotes.isPending ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          </form>
        </TabsContent>
        <TabsContent
          value="recorded"
          forceMount
          hidden={tab !== 'recorded'}
          className="replay-recorded-panel"
        >
          <RecordedBuildOrder
            entry={entry}
            url={url}
            library={library}
            onFilter={onFilter}
            preferences={preferences}
            setPreferences={setPreferences}
          />
        </TabsContent>
        <TabsContent
          value="api"
          forceMount
          hidden={tab !== 'api'}
          className="space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="muted">
              Immutable BAR snapshot, captured when the replay was added.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(
                    JSON.stringify(api, null, 2),
                  )
                  setCopied(true)
                } catch (err) {
                  setError(errorMessage(err))
                }
              }}
            >
              {copied ? 'Copied' : 'Copy JSON'}
            </Button>
          </div>
          <pre className="max-h-[75dvh] overflow-auto rounded-lg border bg-card p-4 text-xs">
            {JSON.stringify(api, null, 2)}
          </pre>
        </TabsContent>
      </Tabs>
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete replay?"
        description="This permanently removes the replay, notes and recording from your local library. Export a JSON backup first if you want to keep a copy."
        destructive
        busy={library.remove.isPending}
        onConfirm={() => void remove()}
      />
    </section>
  )
}
