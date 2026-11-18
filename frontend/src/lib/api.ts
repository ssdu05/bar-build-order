import { z } from 'zod'
import {
  assetRefreshSchema,
  assetStatusSchema,
  entriesSchema,
  entryResponseSchema,
  recordingResponseSchema,
  statusSchema,
  type Recording,
} from './schemas'
import { idFor } from './replays'

export async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      method,
      cache: 'no-store',
      ...(body === undefined
        ? {}
        : {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }),
    })
  } catch {
    throw new Error(
      'Cannot connect to the local server. Make sure it is running.',
    )
  }
  let value: unknown
  try {
    value = await response.json()
  } catch {
    throw new Error(`Unexpected server response (${response.status}).`)
  }
  if (!response.ok) {
    const error = z.object({ error: z.string() }).safeParse(value)
    throw new Error(
      error.success ? error.data.error : `Request failed (${response.status}).`,
    )
  }
  const result = schema.safeParse(value)
  if (!result.success)
    throw new Error(
      `Invalid server data: ${result.error.issues[0].path.join('.')}: ${result.error.issues[0].message}`,
    )
  return result.data
}
const entryPath = (url: string) => `/api/entries/${idFor(url)}`
export const api = {
  entries: () => request('/api/entries', entriesSchema),
  status: () => request('/api/status', statusSchema),
  assets: () => request('/api/assets/status', assetStatusSchema),
  refreshAssets: () =>
    request('/api/assets/refresh', assetRefreshSchema, 'POST', {}),
  create: (body: {
    replay_url: string
    remarks: string
    build_order: string
  }) => request('/api/entries', entryResponseSchema, 'POST', body),
  saveNotes: ({
    url,
    ...notes
  }: {
    url: string
    remarks: string
    build_order: string
  }) => request(entryPath(url), entryResponseSchema, 'PUT', notes),
  remove: (url: string) =>
    request(entryPath(url), z.object({ deleted: z.string() }), 'DELETE'),
  saveRecording: ({
    url,
    recording,
  }: {
    url: string
    recording: Recording | null
  }) =>
    request(
      `${entryPath(url)}/recording`,
      recordingResponseSchema,
      recording ? 'PUT' : 'DELETE',
      recording || undefined,
    ),
}
