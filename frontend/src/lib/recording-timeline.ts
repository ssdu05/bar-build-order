import { useSyncExternalStore } from 'react'

// Preview is deliberately independent of the table's committed filter. Range
// inputs and the renderer subscribe to preview; the workspace subscribes only
// to commit. A drag must never start regrouping/sorting the whole recording.
export function createRecordingTimeline(maximum: number) {
  let preview = maximum
  let committed = maximum
  let gesture: 'pointer' | 'keyboard' | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  const previews = new Set<() => void>()
  const commits = new Set<() => void>()
  const clearTimer = () => {
    clearTimeout(timer)
    timer = undefined
  }
  const commit = () => {
    clearTimer()
    gesture = null
    if (committed === preview) return
    committed = preview
    for (const notify of commits) notify()
  }
  return {
    getSnapshot: () => preview,
    getCommittedSnapshot: () => committed,
    subscribe: (notify: () => void) => {
      previews.add(notify)
      return () => { previews.delete(notify) }
    },
    subscribeCommit: (notify: () => void) => {
      commits.add(notify)
      return () => { commits.delete(notify) }
    },
    begin: (kind: 'pointer' | 'keyboard' = 'pointer') => {
      clearTimer()
      gesture = kind
    },
    end: (kind: 'pointer' | 'keyboard') => {
      if (gesture === kind) commit()
    },
    preview: (value: number) => {
      preview = Math.max(0, Math.min(maximum, value))
      for (const notify of previews) notify()
      clearTimer()
      // Keyboard/accessibility/programmatic changes may have no pointer
      // gesture. Settle those after a short pause, but never during a drag.
      if (!gesture) timer = setTimeout(commit, 180)
    },
    commit,
    dispose: () => {
      clearTimer()
      previews.clear()
      commits.clear()
    },
  }
}

export type RecordingTimeline = ReturnType<typeof createRecordingTimeline>
const subscribeNever = () => () => {}
const unbounded = () => Infinity

export function useRecordingTime(timeline?: RecordingTimeline) {
  return useSyncExternalStore(
    timeline?.subscribe ?? subscribeNever,
    timeline?.getSnapshot ?? unbounded,
  )
}
