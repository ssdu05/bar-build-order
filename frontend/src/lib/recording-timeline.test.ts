import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRecordingTimeline } from './recording-timeline'

afterEach(() => vi.useRealTimers())

describe('recording scrubbing', () => {
  it('notifies preview consumers without committing during a long pointer drag', () => {
    vi.useFakeTimers()
    const timeline = createRecordingTimeline(8000)
    const preview = vi.fn()
    const commit = vi.fn()
    timeline.subscribe(preview)
    timeline.subscribeCommit(commit)
    timeline.begin()
    for (const time of [6000, 100, 7000, 4000]) {
      timeline.preview(time)
      vi.advanceTimersByTime(1000)
    }
    expect(preview).toHaveBeenCalledTimes(4)
    expect(commit).not.toHaveBeenCalled()
    expect(timeline.getSnapshot()).toBe(4000)
    expect(timeline.getCommittedSnapshot()).toBe(8000)
    timeline.end('keyboard') // Unrelated key releases must not end a pointer drag.
    expect(commit).not.toHaveBeenCalled()
    timeline.end('pointer')
    expect(commit).toHaveBeenCalledTimes(1)
    expect(timeline.getCommittedSnapshot()).toBe(4000)
    timeline.commit()
    expect(commit).toHaveBeenCalledTimes(1)
    timeline.dispose()
  })

  it('settles accessibility changes once after a pause, and cancels on disposal', () => {
    vi.useFakeTimers()
    const timeline = createRecordingTimeline(8000)
    const commit = vi.fn()
    timeline.subscribeCommit(commit)
    timeline.preview(100)
    vi.advanceTimersByTime(100)
    timeline.preview(200)
    vi.advanceTimersByTime(179)
    expect(commit).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(timeline.getCommittedSnapshot()).toBe(200)
    expect(commit).toHaveBeenCalledTimes(1)
    timeline.preview(300)
    timeline.dispose()
    vi.runAllTimers()
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it('clamps time and unsubscribes safely', () => {
    const timeline = createRecordingTimeline(8000)
    const preview = vi.fn()
    const unsubscribe = timeline.subscribe(preview)
    timeline.begin()
    timeline.preview(-1)
    expect(timeline.getSnapshot()).toBe(0)
    unsubscribe()
    timeline.preview(10000)
    expect(timeline.getSnapshot()).toBe(8000)
    expect(preview).toHaveBeenCalledTimes(1)
    timeline.dispose()
  })
})
