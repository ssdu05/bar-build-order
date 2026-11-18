import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import type { Entries } from '@/lib/schemas'
import { entriesFixture, recording, url } from '@/test/fixtures'
import { useLibrary } from './use-library'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function mountLibrary() {
  vi.spyOn(api, 'status').mockResolvedValue({
    database_path: 'test.sqlite3',
    storage: 'sqlite',
    count: 2,
  })
  vi.spyOn(api, 'assets').mockResolvedValue({
    maps: {},
    units: {},
    entries: {},
  })
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: 0 },
    },
  })
  client.setQueryData(['entries'], entriesFixture())
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, ...renderHook(useLibrary, { wrapper }) }
}

describe('Query cache mutation isolation', () => {
  it('keeps both notes and recording when concurrent responses finish out of order', async () => {
    const notes = deferred<Awaited<ReturnType<typeof api.saveNotes>>>()
    vi.spyOn(api, 'saveNotes').mockReturnValue(notes.promise)
    vi.spyOn(api, 'saveRecording').mockResolvedValue({
      replay_url: url,
      recording,
    })
    const { result, client } = mountLibrary()
    let noteRequest!: Promise<unknown>
    act(() => {
      noteRequest = result.current.saveNotes.mutateAsync({
        url,
        remarks: 'Updated',
        build_order: 'Updated order',
      })
    })
    await waitFor(() => expect(api.saveNotes).toHaveBeenCalled())
    await act(async () => {
      await result.current.saveRecording.mutateAsync({ url, recording })
    })
    await act(async () => {
      notes.resolve({
        replay_url: url,
        entry: {
          ...entriesFixture()[url],
          remarks: 'Updated',
          build_order: 'Updated order',
        },
      })
      await noteRequest
    })
    const entry = client.getQueryData<Entries>(['entries'])![url]
    expect(entry.remarks).toBe('Updated')
    expect(entry.recorded_build_order?.csv).toBe(recording.csv)
  })
  it('does not resurrect a deleted replay when an earlier note save finishes late', async () => {
    const notes = deferred<Awaited<ReturnType<typeof api.saveNotes>>>()
    vi.spyOn(api, 'saveNotes').mockReturnValue(notes.promise)
    vi.spyOn(api, 'remove').mockResolvedValue({ deleted: url })
    const { result, client } = mountLibrary()
    let noteRequest!: Promise<unknown>
    act(() => {
      noteRequest = result.current.saveNotes.mutateAsync({
        url,
        remarks: 'Late notes',
        build_order: '',
      })
    })
    await waitFor(() => expect(api.saveNotes).toHaveBeenCalled())
    await act(async () => {
      await result.current.remove.mutateAsync(url)
    })
    await act(async () => {
      notes.resolve({ replay_url: url, entry: entriesFixture()[url] })
      await noteRequest
    })
    expect(client.getQueryData<Entries>(['entries'])![url]).toBeUndefined()
  })
})
