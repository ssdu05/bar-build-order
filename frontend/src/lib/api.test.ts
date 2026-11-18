import { z } from 'zod'
import { describe, expect, it, vi } from 'vitest'
import { request } from './api'

describe('validated API boundary', () => {
  it('reports network failures clearly', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')))
    await expect(request('/api/status', z.object({}))).rejects.toThrow(
      'Cannot connect',
    )
  })
  it('rejects non-JSON and malformed successful responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response('<html>Error</html>'))
        .mockResolvedValueOnce(new Response('{"count":"invalid"}')),
    )
    await expect(
      request('/api/status', z.object({ count: z.number() })),
    ).rejects.toThrow('Unexpected server response')
    await expect(
      request('/api/status', z.object({ count: z.number() })),
    ).rejects.toThrow('Invalid server data: count')
  })
  it('preserves structured server errors and sends JSON mutations', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response('{"error":"Replay already exists."}', { status: 409 }),
      )
    vi.stubGlobal('fetch', fetch)
    await expect(
      request('/api/entries', z.object({}), 'POST', { replay_url: 'url' }),
    ).rejects.toThrow('Replay already exists.')
    expect(fetch).toHaveBeenCalledWith(
      '/api/entries',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"replay_url":"url"}',
      }),
    )
  })
})
