import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import {
  csv,
  csvFor,
  entriesFixture,
  importFile,
  recording,
  secondUrl,
  url,
} from './test/fixtures'
import type { Entries, Recording } from './lib/schemas'
import { parseRecording } from './lib/recording'
import * as utils from './lib/utils'
import type { CanvasPlacementsProps } from './components/CanvasPlacements'
import { mockRecordingLayout } from './test/recording-layout'
import { useRecordingTime } from './lib/recording-timeline'

// jsdom has no canvas renderer. Represent the scene input here; rendering is
// exercised separately without adding thousands of DOM nodes in production.
vi.mock('./components/CanvasPlacements', () => ({
  CanvasPlacements: ({ placements, timeline }: CanvasPlacementsProps) => {
    const cutoff = useRecordingTime(timeline)
    return (
      <div>
        {placements
          .filter((placement) => (placement.seconds ?? 0) <= cutoff)
          .map((placement) => (
            <span key={placement.key} role="img" aria-label={placement.label} />
          ))}
      </div>
    )
  },
}))

let entries: Entries
let calls: { path: string; method: string; body: Record<string, unknown> }[]
let failNotes = false
const reply = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

beforeEach(() => {
  mockRecordingLayout()
  entries = entriesFixture()
  calls = []
  failNotes = false
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, options?: RequestInit) => {
      const method = options?.method || 'GET'
      const body = options?.body
        ? (JSON.parse(String(options.body)) as Record<string, unknown>)
        : {}
      calls.push({ path, method, body })
      if (path === '/api/entries') {
        if (method === 'GET') return reply(entries)
        const newUrl = String(body.replay_url)
        if (entries[newUrl])
          return reply({ error: 'Replay already exists.' }, 409)
        const entry = {
          bar_api: {
            id: newUrl.split('/').at(-1),
            Map: { scriptName: 'New map' },
            gameSettings: { ranked_game: true },
          },
          remarks: String(body.remarks),
          build_order: String(body.build_order),
        }
        entries[newUrl] = entry
        return reply({ replay_url: newUrl, entry }, 201)
      }
      if (path === '/api/status')
        return reply({
          database_path: 'C:/library.sqlite3',
          storage: 'sqlite',
          count: Object.keys(entries).length,
        })
      if (path === '/api/assets/status')
        return reply({
          maps: { aurelia: { state: 'missing' } },
          units: {},
          entries: { [url]: { map: 'aurelia', units: [] } },
        })
      if (path === '/api/assets/refresh')
        return reply({
          refreshed: ['aurelia'],
          failed: [],
          units_refreshed: [],
          units_failed: [],
        })
      if (path.endsWith('/recording')) {
        entries[url].recorded_build_order =
          method === 'DELETE' ? null : (body as Recording)
        return reply({
          replay_url: url,
          recording: entries[url].recorded_build_order,
        })
      }
      if (path === `/api/entries/${'a'.repeat(32)}`) {
        if (method === 'DELETE') {
          delete entries[url]
          return reply({ deleted: url })
        }
        if (failNotes) return reply({ error: 'Database is busy.' }, 503)
        entries[url] = {
          ...entries[url],
          remarks: String(body.remarks),
          build_order: String(body.build_order),
        }
        return reply({ replay_url: url, entry: entries[url] })
      }
      throw new Error(`Unexpected request: ${method} ${path}`)
    }),
  )
})

function mount() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
  render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  )
  return userEvent.setup()
}
async function openReplay(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    await screen.findByRole('button', { name: 'View Aurelia replay' }),
  )
  await screen.findByRole('region', { name: 'Replay details' })
}
async function openRecording(user: ReturnType<typeof userEvent.setup>) {
  await openReplay(user)
  await user.click(screen.getByRole('tab', { name: 'Recorded build order' }))
  const filters = screen.queryByRole('button', { name: /^Recording filters/ })
  if (filters) await user.click(filters)
}
function recordedPlacements() {
  return within(
    screen.getByRole('region', { name: 'Recorded placements' }),
  ).queryAllByRole('img', { name: /Alice:|Bob:/ })
}

describe('React replay library', () => {
  it('opens a full-window workspace and restores library filters, focus and scroll on return', async () => {
    const user = mount()
    const replay = await screen.findByRole('button', { name: 'View Aurelia replay' })
    await user.type(screen.getByLabelText('Search library'), 'Aurelia')
    vi.stubGlobal('scrollY', 480)
    await user.click(replay)
    expect(await screen.findByRole('region', { name: 'Replay details' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Replay library' })).toBeNull()
    expect(screen.queryByRole('combobox', { name: 'Ranked status' })).toBeNull()
    const back = screen.getByRole('button', { name: 'Back to library' })
    expect(back).toHaveFocus()
    await user.click(back)
    expect(screen.getByLabelText('Search library')).toHaveValue('Aurelia')
    expect(replay).toHaveFocus()
    expect(window.scrollTo).toHaveBeenLastCalledWith(0, 480)
  })

  it('loads via Query, defaults to ranked, and clears all filters', async () => {
    const user = mount()
    expect(screen.getByText('Loading your replay library…')).toBeInTheDocument()
    await screen.findByRole('button', { name: 'View Aurelia replay' })
    expect(
      screen.queryByRole('button', { name: 'View Other map replay' }),
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear all' }))
    expect(
      screen.getByRole('button', { name: 'View Other map replay' }),
    ).toBeInTheDocument()
    expect(calls.filter((call) => call.path === '/api/entries')).toHaveLength(1)
  })
  it('shows loading errors and supports retry', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const user = mount()
    expect(
      await screen.findAllByText(/Cannot connect to the local server/),
    ).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3))
  })
  it('commits searchable filters only after a selection', async () => {
    const user = mount()
    await screen.findByRole('button', { name: 'View Aurelia replay' })
    await user.click(screen.getByRole('combobox', { name: 'Map' }))
    await user.type(screen.getByPlaceholderText('Search map…'), 'Other')
    expect(
      screen.getByRole('button', { name: 'View Aurelia replay' }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: 'Other map' }))
    expect(screen.getByText('No matching replays')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear all' }))
    expect(
      screen.getByRole('button', { name: 'View Other map replay' }),
    ).toBeInTheDocument()
  })
  it('saves notes without modifying the snapshot or recording', async () => {
    entries[url].recorded_build_order = recording
    const snapshot = structuredClone(entries[url].bar_api)
    const user = mount()
    await openReplay(user)
    await user.clear(screen.getByLabelText('Remarks'))
    await user.type(screen.getByLabelText('Remarks'), 'New notes')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Save changes' }),
      ).toBeDisabled(),
    )
    expect(entries[url].remarks).toBe('New notes')
    expect(entries[url].bar_api).toEqual(snapshot)
    expect(entries[url].recorded_build_order?.csv).toBe(csv)
    expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({
      remarks: 'New notes',
      build_order: '2 mex → solar',
    })
  })
  it('keeps unsaved drafts when assets refresh and preserves the active tab', async () => {
    const user = mount()
    await openReplay(user)
    await user.type(screen.getByLabelText('Remarks'), ' unsaved')
    await user.click(screen.getByRole('tab', { name: 'API JSON' }))
    await user.click(screen.getByRole('button', { name: 'Refresh assets' }))
    await waitFor(() =>
      expect(calls.some((call) => call.path === '/api/assets/refresh')).toBe(
        true,
      ),
    )
    expect(screen.getByRole('tab', { name: 'API JSON' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await user.click(screen.getByRole('tab', { name: 'Overview' }))
    expect(screen.getByLabelText('Remarks')).toHaveValue(
      'Original notes unsaved',
    )
  })
  it('warns before closing unsaved notes, and Cancel retains the draft', async () => {
    const user = mount()
    await openReplay(user)
    await user.type(screen.getByLabelText('Remarks'), ' draft')
    await user.click(
      screen.getByRole('button', { name: 'Close replay details' }),
    )
    const dialog = screen.getByRole('dialog', {
      name: 'Discard unsaved notes?',
    })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.getByLabelText('Remarks')).toHaveValue('Original notes draft')
    await user.click(
      screen.getByRole('button', { name: 'Close replay details' }),
    )
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Continue',
      }),
    )
    expect(
      screen.queryByRole('region', { name: 'Replay details' }),
    ).not.toBeInTheDocument()
  })
  it('retains failed note saves and lets the user retry', async () => {
    failNotes = true
    const user = mount()
    await openReplay(user)
    await user.type(screen.getByLabelText('Remarks'), ' draft')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('Database is busy.')).toBeInTheDocument()
    expect(screen.getByLabelText('Remarks')).toHaveValue('Original notes draft')
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled()
    failNotes = false
    await user.keyboard('{Control>}{Enter}{/Control}')
    await waitFor(() =>
      expect(entries[url].remarks).toBe('Original notes draft'),
    )
  })
  it('deletes only after confirmation', async () => {
    const user = mount()
    await openReplay(user)
    await user.click(screen.getByRole('button', { name: 'Replay actions' }))
    await user.click(screen.getByRole('menuitem', { name: 'Delete replay' }))
    expect(entries[url]).toBeDefined()
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Continue',
      }),
    )
    await waitFor(() => expect(entries[url]).toBeUndefined())
    expect(entries[secondUrl]).toBeDefined()
  })
  it('creates a replay through the validated form and selects it', async () => {
    const user = mount()
    await screen.findByRole('button', { name: 'View Aurelia replay' })
    await user.click(screen.getByRole('button', { name: 'Add replay' }))
    await user.type(
      screen.getByLabelText('Replay URL'),
      `https://bar-rts.com/replays/${'c'.repeat(32)}`,
    )
    await user.type(
      screen.getByLabelText('Remarks (optional)'),
      'Study this opening',
    )
    await user.click(
      screen.getByRole('button', { name: 'Fetch API & create entry' }),
    )
    expect(
      await screen.findByRole('heading', { name: 'New map', level: 2 }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Remarks')).toHaveValue('Study this opening')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  it('rejects invalid replay URLs without sending a mutation', async () => {
    const user = mount()
    await user.click(screen.getByRole('button', { name: 'Add replay' }))
    await user.type(
      screen.getByLabelText('Replay URL'),
      'https://example.com/replays/not-bar',
    )
    await user.click(
      screen.getByRole('button', { name: 'Fetch API & create entry' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Enter a BAR replay URL',
    )
    expect(calls.some((call) => call.method === 'POST')).toBe(false)
  })
  it('reloads external notes after explicitly discarding a draft', async () => {
    const user = mount()
    await openReplay(user)
    await user.type(screen.getByLabelText('Remarks'), ' unsaved')
    entries[url].remarks = 'Saved from another session'
    await user.click(screen.getByRole('button', { name: 'Reload' }))
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Continue',
      }),
    )
    await waitFor(() =>
      expect(screen.getByLabelText('Remarks')).toHaveValue(
        'Saved from another session',
      ),
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('recorded build-order UI', () => {
  it('starts map-first with collapsed metadata and filters, while keeping the time slider available', async () => {
    entries[url].recorded_build_order = recording
    const user = mount()
    await openReplay(user)
    await user.click(screen.getByRole('tab', { name: 'Recorded build order' }))
    expect(screen.getByRole('button', { name: 'Recording details' }))
      .toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: /^Recording filters/ }))
      .toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('slider', { name: /Construction \/ production/ })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Import files' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Recording details' }))
    expect(screen.getByRole('button', { name: 'Remove recording' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Recording details' }))
    expect(screen.queryByRole('button', { name: 'Remove recording' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Hide build list' }))
    expect(document.querySelector('.recording-workspace-container'))
      .toHaveAttribute('data-list-hidden', 'true')
    await user.click(screen.getByRole('button', { name: 'Show build list' }))
    expect(document.querySelector('.recording-workspace-container'))
      .toHaveAttribute('data-list-hidden', 'false')
  })

  it('preserves map zoom, list selection, filters and scroll through expanded map mode', async () => {
    entries[url].recorded_build_order = recording
    const user = mount()
    await openRecording(user)
    await user.type(screen.getByLabelText('Building / unit name'), 'Pawn')
    const selected = screen.getByRole('checkbox', { name: 'Select Pawn (Bob, Unit 3) for map' })
    await user.click(selected)
    const list = screen.getByRole('region', { name: 'Build-order records' })
    fireEvent.scroll(list, { target: { scrollTop: 120, scrollLeft: 80 } })
    const map = screen.getByRole('group', { name: 'Build placements on Aurelia' })
    const initial = map.getAttribute('viewBox')
    await user.click(screen.getByRole('button', { name: 'Zoom in' }))
    await waitFor(() => expect(map.getAttribute('viewBox')).not.toBe(initial))
    const viewBox = map.getAttribute('viewBox')
    await user.click(screen.getByRole('button', { name: 'Expand map' }))
    const expanded = screen.getByRole('dialog', { name: 'Expanded recorded map' })
    expect(expanded).toContainElement(map)
    expect(screen.queryByRole('region', { name: 'Build-order records' })).toBeNull()
    const slider = within(expanded).getByRole('slider', { name: /Construction \/ production/ })
    fireEvent.change(slider, { target: { value: 4 } })
    expect(within(expanded).queryAllByRole('img', { name: /Bob:/ })).toHaveLength(0)
    fireEvent.change(slider, { target: { value: 8 } })
    expect(within(expanded).queryAllByRole('img', { name: /Bob:/ })).toHaveLength(1)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('group', { name: 'Build placements on Aurelia' })).toBe(map)
    expect(map).toHaveAttribute('viewBox', viewBox)
    expect(selected).toBeChecked()
    expect(screen.getByLabelText('Building / unit name')).toHaveValue('Pawn')
    expect(list.scrollTop).toBe(120)
    expect(list.scrollLeft).toBe(80)
    expect(screen.getByRole('button', { name: 'Expand map' })).toHaveFocus()
  })

  it('keeps filters, map zoom, selection and list position when switching panels', async () => {
    entries[url].recorded_build_order = recording
    const user = mount()
    await openRecording(user)
    const panels = screen.getByRole('tablist', { name: 'Recording panels' })
    const mapTab = within(panels).getByRole('tab', { name: 'Map' })
    const listTab = within(panels).getByRole('tab', { name: 'List' })
    const map = screen.getByRole('group', { name: 'Build placements on Aurelia' })
    const initialViewport = map.getAttribute('viewBox')
    await user.click(screen.getByRole('button', { name: 'Zoom in' }))
    await waitFor(() =>
      expect(map.getAttribute('viewBox')).not.toBe(initialViewport),
    )
    const viewport = map.getAttribute('viewBox')

    await user.click(listTab)
    expect(listTab).toHaveAttribute('aria-selected', 'true')
    const view = within(
      screen.getByRole('tabpanel', { name: 'List' }),
    ).getByRole('group', { name: 'Recording view' })
    expect(
      within(view).getByRole('button', { name: 'Timeline' }),
    ).toBeInTheDocument()
    expect(
      within(view).getByRole('button', { name: 'By constructor' }),
    ).toBeInTheDocument()
    await user.type(screen.getByLabelText('Building / unit name'), 'Pawn')
    const selected = screen.getByRole('checkbox', {
      name: 'Select Pawn (Bob, Unit 3) for map',
    })
    await user.click(selected)
    const list = screen.getByRole('region', { name: 'Build-order records' })
    fireEvent.scroll(list, { target: { scrollTop: 120, scrollLeft: 80 } })

    await user.click(mapTab)
    expect(mapTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('Building / unit name')).toHaveValue('Pawn')
    expect(
      screen.getByRole('group', { name: 'Build placements on Aurelia' }),
    ).toBe(map)
    expect(map).toHaveAttribute('viewBox', viewport)
    expect(recordedPlacements()).toHaveLength(1)
    expect(
      screen.getByText('Map: 1 of 1 selected records match the current filters.'),
    ).toBeInTheDocument()

    await user.keyboard('{ArrowRight}')
    expect(listTab).toHaveAttribute('aria-selected', 'true')
    expect(selected).toBeChecked()
    expect(
      screen.getByRole('region', { name: 'Build-order records' }),
    ).toBe(list)
    expect(list.scrollTop).toBe(120)
    expect(list.scrollLeft).toBe(80)
  })
  it('selects groups and individual rows for the map without changing the list or CSV', async () => {
    entries[url].recorded_build_order = recording
    const download = vi.spyOn(utils, 'download').mockImplementation(() => {})
    const user = mount()
    await openRecording(user)
    expect(recordedPlacements()).toHaveLength(3)
    const map = screen.getByRole('group', { name: 'Build placements on Aurelia' })
    const initialViewport = map.getAttribute('viewBox')
    await user.click(screen.getByRole('button', { name: 'Zoom in' }))
    await waitFor(() =>
      expect(map.getAttribute('viewBox')).not.toBe(initialViewport),
    )
    const viewport = map.getAttribute('viewBox')
    const group = screen.getByRole('checkbox', {
      name: 'Select 2 × Metal Extractor (Alice) for map',
    })
    const summary = screen.getByRole('button', { name: /2 × Metal Extractor/ })
    expect(summary).toHaveClass('text-primary', 'hover:text-primary')
    expect(
      within(screen.getByRole('table')).getByText('Pawn'),
    ).not.toHaveClass('text-primary')
    await user.click(group)
    expect(group).toBeChecked()
    expect(recordedPlacements()).toHaveLength(2)
    expect(map).toHaveAttribute('viewBox', viewport)
    expect(screen.getByText(/3 of 3 records/)).toBeInTheDocument()
    expect(
      within(screen.getByRole('table')).getByText('Pawn'),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Export filtered CSV' }))
    expect(parseRecording(download.mock.calls[0][0])).toHaveLength(3)

    await user.click(summary)
    expect(summary).toHaveClass('text-primary', 'hover:text-primary')
    const children = within(screen.getByRole('table')).getAllByText(
      'Metal Extractor',
    )
    expect(children).toHaveLength(2)
    for (const child of children) {
      expect(child).toHaveClass('ml-6', 'text-primary')
      expect(within(child).getByText('↳')).toHaveAttribute('aria-hidden', 'true')
    }
    expect(
      within(screen.getByRole('table')).getByText('Pawn'),
    ).not.toHaveClass('ml-6', 'text-primary')
    const first = screen.getByRole('checkbox', {
      name: 'Select Metal Extractor (Alice, Unit 1) for map',
    })
    expect(first).toBeChecked()
    await user.click(first)
    expect(group).toBePartiallyChecked()
    expect(recordedPlacements()).toHaveLength(1)
    expect(recordedPlacements()[0]).toHaveAccessibleName(/00:05 Alice:/)
    await user.click(
      screen.getByRole('checkbox', {
        name: 'Select Pawn (Bob, Unit 3) for map',
      }),
    )
    expect(recordedPlacements()).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: /Start/ }))
    await user.click(
      screen.getByLabelText('Summarise consecutive buildings / units'),
    )
    await user.click(screen.getByRole('button', { name: 'By constructor' }))
    for (const child of within(screen.getByRole('table')).getAllByText(
      'Metal Extractor',
    )) {
      expect(child).not.toHaveClass('ml-6', 'text-primary')
    }
    expect(
      screen.getByRole('checkbox', {
        name: 'Select Metal Extractor (Alice, Unit 1) for map',
      }),
    ).not.toBeChecked()
    expect(
      screen.getByRole('checkbox', {
        name: 'Select Metal Extractor (Alice, Unit 2) for map',
      }),
    ).toBeChecked()
    expect(recordedPlacements()).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Clear map selection' }))
    expect(recordedPlacements()).toHaveLength(3)
    expect(
      screen.getByRole('button', { name: 'Clear map selection' }),
    ).toBeDisabled()
  })
  it('selects a constructor building group or all builds under that constructor', async () => {
    const build = {
      player: 'Alice',
      team_id: '0',
      building: 'Wind Turbine',
      unit_def_id: '10',
      builder_id: '1',
      builder_name: 'Bot',
      x: '100',
      z: '200',
    }
    entries[url].recorded_build_order = {
      ...recording,
      csv: csvFor(
        { ...build, unit_id: '101', start_seconds: '1' },
        {
          ...build,
          building: 'Converter',
          unit_def_id: '20',
          builder_id: '2',
          builder_name: 'Commander',
          unit_id: '102',
          start_seconds: '2',
        },
        { ...build, unit_id: '103', start_seconds: '3' },
        {
          ...build,
          building: 'Converter',
          unit_def_id: '20',
          unit_id: '104',
          start_seconds: '4',
        },
        { ...build, unit_id: '105', start_seconds: '5' },
      ),
    }
    const user = mount()
    await openRecording(user)
    await user.click(screen.getByRole('button', { name: 'By constructor' }))
    const constructor = screen.getByRole('checkbox', {
      name: 'Select all filtered builds by Bot #1 (Alice) for map',
    })
    const group = screen.getByRole('checkbox', {
      name: 'Select 2 × Wind Turbine (Alice) for map',
    })
    await user.click(group)
    expect(recordedPlacements()).toHaveLength(2)
    expect(constructor).toBePartiallyChecked()
    await user.click(constructor)
    expect(recordedPlacements()).toHaveLength(4)
    expect(constructor).toBeChecked()
    expect(
      screen.getByRole('checkbox', {
        name: 'Select all filtered builds by Commander #2 (Alice) for map',
      }),
    ).not.toBeChecked()
    await user.click(screen.getByRole('button', { name: /2 × Wind Turbine/ }))
    await user.click(
      screen.getByRole('checkbox', {
        name: 'Select Wind Turbine (Alice, Unit 101) for map',
      }),
    )
    expect(constructor).toBePartiallyChecked()
    expect(group).toBePartiallyChecked()
    expect(recordedPlacements()).toHaveLength(3)
    await user.click(screen.getByRole('button', { name: 'Clear map selection' }))
    await user.type(screen.getByLabelText('Building / unit name'), 'Wind')
    await user.click(constructor)
    expect(recordedPlacements()).toHaveLength(3)
    await user.clear(screen.getByLabelText('Building / unit name'))
    expect(constructor).toBePartiallyChecked()
    expect(recordedPlacements()).toHaveLength(3)
  })
  it('intersects map selections with filters, retains hidden selections, and can select all filtered rows', async () => {
    entries[url].recorded_build_order = recording
    const user = mount()
    await openRecording(user)
    await user.click(screen.getByRole('button', { name: /2 × Metal Extractor/ }))
    await user.click(
      screen.getByRole('checkbox', {
        name: 'Select Metal Extractor (Alice, Unit 1) for map',
      }),
    )
    await user.click(screen.getByRole('combobox', { name: 'Show' }))
    await user.click(screen.getByRole('option', { name: 'Units only' }))
    expect(recordedPlacements()).toHaveLength(0)
    expect(
      screen.getByText('Map: 0 of 1 selected records match the current filters.'),
    ).toBeInTheDocument()
    expect(screen.getByText(/1 of 3 records/)).toBeInTheDocument()
    const all = screen.getByRole('checkbox', {
      name: 'Select all filtered records for map',
    })
    expect(all).not.toBeChecked()
    await user.click(all)
    expect(recordedPlacements()).toHaveLength(1)
    expect(
      screen.getByText('Map: 1 of 2 selected records match the current filters.'),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('combobox', { name: 'Show' }))
    await user.click(screen.getByRole('option', { name: 'Buildings & units' }))
    expect(recordedPlacements()).toHaveLength(2)
    expect(all).toBePartiallyChecked()
    await user.click(all)
    expect(all).toBeChecked()
    expect(recordedPlacements()).toHaveLength(3)
    await user.click(all)
    expect(all).not.toBeChecked()
    expect(recordedPlacements()).toHaveLength(3)
    expect(
      screen.getByRole('button', { name: 'Clear map selection' }),
    ).toBeDisabled()
  })
  it('keeps selection on asset refresh but clears it for a replacement CSV or another replay', async () => {
    entries[url].recorded_build_order = recording
    entries[secondUrl].recorded_build_order = recording
    const user = mount()
    await openRecording(user)
    await user.click(
      screen.getByRole('checkbox', {
        name: 'Select Pawn (Bob, Unit 3) for map',
      }),
    )
    await user.click(
      screen.getAllByRole('button', { name: 'Refresh assets' })[0],
    )
    await waitFor(() =>
      expect(
        calls.some((call) => call.path === '/api/assets/refresh'),
      ).toBe(true),
    )
    expect(recordedPlacements()).toHaveLength(1)
    expect(
      screen.getByRole('checkbox', {
        name: 'Select Pawn (Bob, Unit 3) for map',
      }),
    ).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Import files' }))
    await user.upload(
      screen.getByLabelText(/Recording CSV/),
      importFile(
        csvFor(
          { player: 'Alice', building: 'Wind', unit_id: '999', x: '100', z: '200' },
          { player: 'Alice', building: 'Solar', unit_id: '998', x: '300', z: '400' },
        ),
        'replacement.csv',
      ),
    )
    await screen.findByText(/Saved locally: replacement.csv/)
    expect(recordedPlacements()).toHaveLength(2)
    expect(
      screen.getByRole('button', { name: 'Clear map selection' }),
    ).toBeDisabled()
    await user.click(
      screen.getByRole('checkbox', {
        name: 'Select Wind (Alice, Unit 999) for map',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Back to library' }))
    await user.click(screen.getByRole('button', { name: 'Clear all' }))
    await user.click(
      screen.getByRole('button', { name: 'View Other map replay' }),
    )
    await user.click(screen.getByRole('tab', { name: 'Recorded build order' }))
    expect(
      screen.getByRole('button', { name: 'Clear map selection' }),
    ).toBeDisabled()
    expect(
      screen.getByRole('checkbox', {
        name: 'Select Pawn (Bob, Unit 3) for map',
      }),
    ).not.toBeChecked()
  })
  it('shows per-constructor sequences, expands actual builds, and preserves the timeline', async () => {
    const build = {
      player: 'Alice',
      team_id: '0',
      building: 'Wind Turbine',
      unit_def_id: '10',
      builder_id: '1',
      builder_name: 'Construction Bot',
      x: '100',
      z: '200',
    }
    entries[url].recorded_build_order = {
      ...recording,
      csv: csvFor(
        {
          ...build,
          unit_id: '101',
          start_seconds: '540',
          finish_seconds: '550',
          status: 'finished',
        },
        {
          ...build,
          building: 'Energy Converter',
          unit_def_id: '20',
          unit_id: '102',
          builder_id: '2',
          builder_name: 'Commander',
          start_seconds: '542',
        },
        { ...build, unit_id: '103', start_seconds: '543' },
        { ...build, unit_id: '104', builder_id: '3', start_seconds: '544' },
      ),
    }
    const original = entries[url].recorded_build_order?.csv
    const download = vi.spyOn(utils, 'download').mockImplementation(() => {})
    const user = mount()
    await openRecording(user)
    expect(
      screen.getByRole('button', { name: /2 × Wind Turbine/ }).closest('tr'),
    ).toHaveTextContent('09:03–09:04')
    await user.click(screen.getByRole('button', { name: 'By constructor' }))
    expect(
      screen.getByRole('button', { name: 'By constructor' }),
    ).toHaveAttribute('aria-pressed', 'true')
    const table = screen.getByRole('table')
    expect(
      within(table).getAllByRole('heading').map((heading) => heading.textContent),
    ).toEqual(['Construction Bot #1', 'Commander #2', 'Construction Bot #3'])
    const group = within(table).getByRole('button', { name: /2 × Wind Turbine/ })
    expect(group).toHaveClass('text-primary', 'hover:text-primary')
    expect(group.closest('tr')).toHaveTextContent('09:00–09:03')
    expect(group.closest('tr')).toHaveTextContent('09:10 (1 unknown)')
    expect(group.closest('tr')).toHaveTextContent('1 finished')
    expect(
      within(
        screen.getByRole('region', { name: 'Recorded placements' }),
      ).getAllByRole('img', { name: /Alice:/ }),
    ).toHaveLength(4)
    await user.click(screen.getByRole('button', { name: 'Export filtered CSV' }))
    expect(
      parseRecording(download.mock.calls[0][0]).map((row) => row.unit_id),
    ).toEqual(['101', '102', '103', '104'])
    await user.click(group)
    expect(group).toHaveAttribute('aria-expanded', 'true')
    for (const id of ['101', '103']) {
      const childRow = within(table).getByText(id).closest('tr')!
      expect(within(childRow).getByText('Wind Turbine')).toHaveClass(
        'ml-6',
        'text-primary',
      )
    }
    const singleRow = within(table).getByText('104').closest('tr')!
    expect(within(singleRow).getByText('Wind Turbine')).not.toHaveClass(
      'ml-6',
      'text-primary',
    )
    expect(within(table).getByText('101')).toBeInTheDocument()
    expect(within(table).getByText('103')).toBeInTheDocument()
    await user.click(
      screen.getByLabelText('Summarise consecutive buildings / units'),
    )
    expect(
      within(table).queryByRole('button', { name: /2 × Wind Turbine/ }),
    ).not.toBeInTheDocument()
    expect(within(table).getByText('101')).toBeInTheDocument()
    await user.click(
      screen.getByLabelText('Summarise consecutive buildings / units'),
    )
    await user.click(screen.getByRole('button', { name: 'Timeline' }))
    expect(within(table).queryByRole('heading')).not.toBeInTheDocument()
    expect(
      within(table).getByRole('button', { name: /2 × Wind Turbine/ }).closest('tr'),
    ).toHaveTextContent('09:03–09:04')
    expect(entries[url].recorded_build_order?.csv).toBe(original)
    expect(calls.some((call) => call.path.endsWith('/recording'))).toBe(false)
  })
  it('does not join filtered-out constructor steps, shares filters, and retains the view on refresh and replay changes', async () => {
    const build = {
      player: 'Alice',
      building: 'Wind Turbine',
      unit_def_id: '10',
      builder_id: '1',
    }
    entries[url].recorded_build_order = {
      ...recording,
      csv: csvFor(
        { ...build, start_seconds: '1', status: 'finished' },
        {
          ...build,
          building: 'Pawn',
          unit_kind: 'unit',
          unit_def_id: '20',
          start_seconds: '2',
          status: 'finished',
        },
        { ...build, start_seconds: '3' },
        { ...build, player: 'Bob', builder_id: '', start_seconds: '4' },
        { ...build, player: 'Bob', builder_id: '', start_seconds: '5' },
      ),
    }
    entries[secondUrl].recorded_build_order = recording
    const download = vi.spyOn(utils, 'download').mockImplementation(() => {})
    const user = mount()
    await openRecording(user)
    await user.click(screen.getByRole('button', { name: 'By constructor' }))
    expect(
      screen.getByRole('heading', { name: 'Unknown constructor / factory' }),
    ).toBeInTheDocument()
    const table = screen.getByRole('table')
    expect(
      within(table).queryByRole('button', { name: /2 × Wind Turbine/ }),
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('combobox', { name: 'Show' }))
    await user.click(screen.getByRole('option', { name: 'Buildings only' }))
    await user.type(screen.getByLabelText('Building / unit name'), 'Wind')
    expect(
      within(table).queryByRole('button', { name: /2 × Wind Turbine/ }),
    ).not.toBeInTheDocument()
    expect(screen.getByText(/4 of 5 records/)).toBeInTheDocument()
    await user.click(
      screen.getByRole('combobox', { name: 'Construction status' }),
    )
    await user.click(screen.getByRole('option', { name: 'Completed' }))
    expect(screen.getByText(/1 of 5 records/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Export filtered CSV' }))
    const exported = parseRecording(download.mock.calls[0][0])
    expect(exported).toHaveLength(1)
    expect(exported[0].start_seconds).toBe('1')
    expect(
      within(table).queryByRole('heading', {
        name: 'Unknown constructor / factory',
      }),
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Timeline' }))
    expect(screen.getByText(/1 of 5 records/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'By constructor' }))
    await user.click(
      screen.getAllByRole('button', { name: 'Refresh assets' })[0],
    )
    expect(
      screen.getByRole('button', { name: 'By constructor' }),
    ).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Back to library' }))
    await user.click(screen.getByRole('button', { name: 'Clear all' }))
    await user.click(
      screen.getByRole('button', { name: 'View Other map replay' }),
    )
    await user.click(screen.getByRole('tab', { name: 'Recorded build order' }))
    await user.click(screen.getByRole('button', { name: /^Recording filters/ }))
    expect(
      screen.getByRole('button', { name: 'By constructor' }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('combobox', { name: 'Show' })).toHaveTextContent(
      'Buildings only',
    )
  })
  it('paginates constructor build groups rather than whole constructors', async () => {
    entries[url].recorded_build_order = {
      ...recording,
      csv: csvFor(
        ...Array.from({ length: 201 }, (_, i) => ({
          player: 'Alice',
          building: `Building ${i}`,
          unit_def_id: String(i + 1),
          builder_id: '1',
          builder_name: 'Bot',
          start_seconds: String(i),
          x: '100',
          z: '200',
        })),
      ),
    }
    const user = mount()
    await openRecording(user)
    await user.click(screen.getByRole('button', { name: 'By constructor' }))
    expect(screen.getByRole('table')).toHaveAttribute('aria-rowcount', '202')
    expect(
      within(screen.getByRole('table')).getAllByRole('row').length,
    ).toBeLessThan(30)
    await user.click(
      screen.getByRole('checkbox', {
        name: 'Select all filtered builds by Bot #1 (Alice) for map',
      }),
    )
    expect(recordedPlacements()).toHaveLength(201)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('Page 2 / 2')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Bot #1' })).toBeInTheDocument()
    expect(
      within(screen.getByRole('table')).getByText('Building 200'),
    ).toBeInTheDocument()
    const last = screen.getByRole('checkbox', {
      name: 'Select Building 200 (Alice, record 201) for map',
    })
    expect(last).toBeChecked()
    await user.click(last)
    expect(recordedPlacements()).toHaveLength(200)
    expect(
      screen.getByRole('checkbox', {
        name: 'Select all filtered builds by Bot #1 (Alice) for map',
      }),
    ).toBePartiallyChecked()
    await user.click(screen.getByRole('button', { name: 'Timeline' }))
    expect(screen.getByText('Page 1 / 2')).toBeInTheDocument()
    expect(recordedPlacements()).toHaveLength(200)
  })
  it('sorts builds inside each constructor without interleaving constructors', async () => {
    const build = { player: 'Alice', builder_name: 'Bot' }
    entries[url].recorded_build_order = {
      ...recording,
      csv: csvFor(
        { ...build, builder_id: '1', building: 'Wind', start_seconds: '1' },
        { ...build, builder_id: '2', building: 'Solar', start_seconds: '2' },
        { ...build, builder_id: '1', building: 'Converter', start_seconds: '3' },
        { ...build, builder_id: '2', building: 'Mex', start_seconds: '4' },
      ),
    }
    const user = mount()
    await openRecording(user)
    await user.click(screen.getByRole('button', { name: 'By constructor' }))
    const names = () =>
      within(screen.getByRole('table')).getAllByRole('row')
        .slice(1)
        .map((row) => row.textContent)
    expect(names()).toEqual([
      expect.stringContaining('Bot #1'),
      expect.stringContaining('Wind'),
      expect.stringContaining('Converter'),
      expect.stringContaining('Bot #2'),
      expect.stringContaining('Solar'),
      expect.stringContaining('Mex'),
    ])
    await user.click(screen.getByRole('button', { name: /Start/ }))
    expect(names()).toEqual([
      expect.stringContaining('Bot #1'),
      expect.stringContaining('Converter'),
      expect.stringContaining('Wind'),
      expect.stringContaining('Bot #2'),
      expect.stringContaining('Mex'),
      expect.stringContaining('Solar'),
    ])
    await user.click(screen.getByRole('button', { name: /Building \/ unit/ }))
    expect(names()[1]).toContain('Converter')
    expect(names()[4]).toContain('Mex')
    await user.click(screen.getByRole('button', { name: 'Timeline' }))
    expect(
      within(screen.getByRole('table')).queryByRole('heading'),
    ).not.toBeInTheDocument()
    expect(names()[0]).toContain('Converter')
    expect(names()[1]).toContain('Mex')
  })
  it('sorts grouped runs by their first start, and supports grouped name sorting', async () => {
    entries[url].recorded_build_order = {
      ...recording,
      csv: csvFor(
        {
          player: 'Alice',
          building: 'Mex',
          unit_def_id: '10',
          start_seconds: '1',
        },
        {
          player: 'Bob',
          building: 'Solar',
          unit_def_id: '20',
          start_seconds: '3',
        },
        {
          player: 'Alice',
          building: 'Mex',
          unit_def_id: '10',
          start_seconds: '5',
        },
      ),
    }
    const user = mount()
    await openRecording(user)
    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('2 × Mex')
    await user.click(screen.getByRole('button', { name: /Building \/ unit/ }))
    await user.click(screen.getByRole('button', { name: /Building \/ unit/ }))
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('Solar')
  })
  it('groups consecutive runs, expands records, filters and sorts through TanStack Table', async () => {
    entries[url].recorded_build_order = recording
    const user = mount()
    await openRecording(user)
    const group = screen.getByRole('button', { name: /2 × Metal Extractor/ })
    expect(group).toHaveAttribute('aria-expanded', 'false')
    await user.click(group)
    expect(group).toHaveAttribute('aria-expanded', 'true')
    await user.click(screen.getByRole('combobox', { name: 'Show' }))
    await user.click(screen.getByRole('option', { name: 'Units only' }))
    expect(screen.getByText(/1 of 3 records/)).toBeInTheDocument()
    expect(
      within(screen.getByRole('table')).getByText('Pawn'),
    ).toBeInTheDocument()
    expect(
      within(screen.getByRole('table')).queryByText('Metal Extractor'),
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Start/ }))
    expect(screen.getByRole('button', { name: /Start/ })).toHaveTextContent('↓')
  })
  it('imports CSV and does not overwrite unsaved notes', async () => {
    const user = mount()
    await openReplay(user)
    await user.type(screen.getByLabelText('Remarks'), ' draft')
    await user.click(screen.getByRole('tab', { name: 'Recorded build order' }))
    await user.click(screen.getByRole('button', { name: 'Import files' }))
    await user.upload(
      screen.getByLabelText(/Recording CSV/),
      importFile(csv, 'match.csv'),
    )
    expect(
      await screen.findByText(/Saved locally: match.csv/),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Overview' }))
    expect(screen.getByLabelText('Remarks')).toHaveValue('Original notes draft')
    expect(entries[url].remarks).toBe('Original notes')
  })
  it('keeps the existing recording on invalid imports', async () => {
    entries[url].recorded_build_order = recording
    const user = mount()
    await openRecording(user)
    await user.click(screen.getByRole('button', { name: 'Import files' }))
    await user.upload(
      screen.getByLabelText(/Recording CSV/),
      importFile('bad,csv\n1,2', 'bad.csv'),
    )
    expect(
      await screen.findAllByText(/Import failed; existing recording kept/),
    ).not.toHaveLength(0)
    expect(entries[url].recorded_build_order?.csv).toBe(csv)
    expect(calls.some((call) => call.path.endsWith('/recording'))).toBe(false)
  })
  it('requires confirmation for mismatched metadata', async () => {
    const user = mount()
    await openRecording(user)
    await user.click(screen.getByRole('button', { name: 'Import files' }))
    await user.upload(
      screen.getByLabelText(/Recording CSV/),
      importFile(csvFor({ map: 'Wrong map' }), 'wrong.csv'),
    )
    const dialog = await screen.findByRole('dialog', {
      name: 'Recording metadata does not match',
    })
    expect(entries[url].recorded_build_order).toBeUndefined()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(calls.some((call) => call.path.endsWith('/recording'))).toBe(false)
  })
  it('renders imported names as text, never markup', async () => {
    entries[url].recorded_build_order = {
      ...recording,
      csv: csvFor({ building: '<img src=x onerror=alert(1)>' }),
    }
    const user = mount()
    await openRecording(user)
    const table = screen.getByRole('table')
    expect(
      within(table).getByText('<img src=x onerror=alert(1)>'),
    ).toBeInTheDocument()
    expect(table.querySelector('img[src="x"]')).toBeNull()
  })
  it('zooms maps using buttons and keyboard', async () => {
    const user = mount()
    await openReplay(user)
    const map = screen.getByRole('group', { name: 'Player spawns on Aurelia' })
    const before = map.getAttribute('viewBox')
    await user.click(screen.getByRole('button', { name: 'Zoom in' }))
    await waitFor(() => expect(map.getAttribute('viewBox')).not.toBe(before))
    fireEvent.keyDown(map, { key: 'Home' })
    await waitFor(() => expect(map).toHaveAttribute('viewBox', before))
  })
  it('paginates 200 summary items, then resets to page one when filtering', async () => {
    entries[url].recorded_build_order = {
      ...recording,
      csv: csvFor(
        ...Array.from({ length: 201 }, (_, i) => ({
          building: `Building ${i}`,
          unit_def_id: String(i + 1),
          start_seconds: String(i),
        })),
      ),
    }
    const user = mount()
    await openRecording(user)
    expect(screen.getByRole('table')).toHaveAttribute('aria-rowcount', '201')
    expect(
      within(screen.getByRole('table')).getAllByRole('row').length,
    ).toBeLessThan(30)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('Page 2 / 2')).toBeInTheDocument()
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(
      2,
    )
    await user.type(screen.getByLabelText('Building / unit name'), 'Building 0')
    expect(screen.getByText('Page 1 / 1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })
  it('does not merge runs across a different build hidden by a name filter', async () => {
    entries[url].recorded_build_order = {
      ...recording,
      csv: csvFor(
        {
          player: 'Alice',
          building: 'Mex',
          unit_def_id: '10',
          start_seconds: '1',
        },
        {
          player: 'Alice',
          building: 'Solar',
          unit_def_id: '20',
          start_seconds: '2',
        },
        {
          player: 'Alice',
          building: 'Mex',
          unit_def_id: '10',
          start_seconds: '3',
        },
      ),
    }
    const user = mount()
    await openRecording(user)
    await user.type(screen.getByLabelText('Building / unit name'), 'Mex')
    expect(within(screen.getByRole('table')).getAllByText('Mex')).toHaveLength(
      2,
    )
    expect(
      screen.queryByRole('button', { name: /2 × Mex/ }),
    ).not.toBeInTheDocument()
  })
})
