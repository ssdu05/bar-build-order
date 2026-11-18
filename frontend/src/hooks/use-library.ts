import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { Entries } from '@/lib/schemas'

export function useLibrary() {
  const client = useQueryClient()
  const entries = useQuery({ queryKey: ['entries'], queryFn: api.entries })
  const status = useQuery({ queryKey: ['status'], queryFn: api.status })
  const assets = useQuery({
    queryKey: ['assets'],
    queryFn: api.assets,
    enabled: entries.isSuccess,
  })
  const cancelEntryReads = () => client.cancelQueries({ queryKey: ['entries'] })
  const invalidateMetadata = () => {
    void client.invalidateQueries({ queryKey: ['assets'] })
    void client.invalidateQueries({ queryKey: ['status'] })
  }
  const create = useMutation({
    mutationFn: api.create,
    onMutate: cancelEntryReads,
    onSuccess: (result) => {
      client.setQueryData<Entries>(['entries'], (previous) => ({
        ...previous,
        [result.replay_url]: result.entry,
      }))
      invalidateMetadata()
    },
  })
  const saveNotes = useMutation({
    mutationFn: api.saveNotes,
    onMutate: cancelEntryReads,
    onSuccess: (result) => {
      // Merge only changed fields: a simultaneous recording import owns its fields.
      client.setQueryData<Entries>(['entries'], (previous) =>
        previous?.[result.replay_url]
          ? {
              ...previous,
              [result.replay_url]: {
                ...previous[result.replay_url],
                remarks: result.entry.remarks,
                build_order: result.entry.build_order,
              },
            }
          : previous,
      )
    },
  })
  const saveRecording = useMutation({
    mutationFn: api.saveRecording,
    onMutate: cancelEntryReads,
    onSuccess: (result) => {
      client.setQueryData<Entries>(['entries'], (previous) =>
        previous?.[result.replay_url]
          ? {
              ...previous,
              [result.replay_url]: {
                ...previous[result.replay_url],
                recorded_build_order: result.recording,
              },
            }
          : previous,
      )
      invalidateMetadata()
    },
  })
  const remove = useMutation({
    mutationFn: api.remove,
    onMutate: cancelEntryReads,
    onSuccess: (_result, url) => {
      client.setQueryData<Entries>(['entries'], (previous) =>
        Object.fromEntries(
          Object.entries(previous || {}).filter(([key]) => key !== url),
        ),
      )
      invalidateMetadata()
    },
  })
  const refreshAssets = useMutation({
    mutationFn: api.refreshAssets,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['assets'] })
    },
  })
  const reload = async () => {
    await client.invalidateQueries({ queryKey: ['entries'] })
    invalidateMetadata()
  }
  return {
    entries,
    status,
    assets,
    create,
    saveNotes,
    saveRecording,
    remove,
    refreshAssets,
    reload,
  }
}
export type Library = ReturnType<typeof useLibrary>
