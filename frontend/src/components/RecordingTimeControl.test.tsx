import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createRecordingTimeline } from '@/lib/recording-timeline'
import { RecordingTimeControl } from './RecordingTimeControl'

function mount() {
  const timeline = createRecordingTimeline(180)
  const commit = vi.fn()
  timeline.subscribeCommit(commit)
  render(<RecordingTimeControl timeline={timeline} maximum={180} id="time" />)
  return {
    timeline,
    commit,
    input: screen.getByRole('textbox'),
    slider: screen.getByRole('slider'),
  }
}

describe('recording time entry', () => {
  it('selects the time for editing and applies minutes:seconds on Enter', () => {
    const { input, slider, timeline, commit } = mount()
    expect(input).toHaveValue('03:00')
    fireEvent.focus(input)
    expect((input as HTMLInputElement).selectionStart).toBe(0)
    expect((input as HTMLInputElement).selectionEnd).toBe(5)
    fireEvent.change(input, { target: { value: '1:25' } })
    expect(timeline.getSnapshot()).toBe(180)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(input).toHaveValue('01:25')
    expect(slider).toHaveValue('85')
    expect(timeline.getCommittedSnapshot()).toBe(85)
    expect(commit).toHaveBeenCalledOnce()
    fireEvent.blur(input)
    expect(commit).toHaveBeenCalledOnce()
  })

  it('accepts seconds on blur and clamps to the recording duration', () => {
    const { input, timeline } = mount()
    fireEvent.change(input, { target: { value: '65.5' } })
    fireEvent.blur(input)
    expect(timeline.getCommittedSnapshot()).toBe(65.5)
    fireEvent.change(input, { target: { value: '99:59' } })
    fireEvent.blur(input)
    expect(timeline.getCommittedSnapshot()).toBe(180)
    expect(input).toHaveValue('03:00')
  })

  it('rejects invalid times without changing the cutoff and supports Escape', () => {
    const { input, timeline, commit } = mount()
    for (const value of ['', '-1', '1:99', 'abc']) {
      fireEvent.change(input, { target: { value } })
      expect(input).toHaveAttribute('aria-invalid', 'true')
      fireEvent.blur(input)
      expect(input).toHaveValue('03:00')
    }
    fireEvent.change(input, { target: { value: '1:00' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    fireEvent.blur(input)
    expect(input).toHaveValue('03:00')
    expect(timeline.getCommittedSnapshot()).toBe(180)
    expect(commit).not.toHaveBeenCalled()
  })

  it('stays synchronized with other time controls', () => {
    const { input, slider, timeline } = mount()
    act(() => {
      timeline.preview(42)
      timeline.commit()
    })
    expect(input).toHaveValue('00:42')
    expect(slider).toHaveValue('42')
    fireEvent.change(slider, { target: { value: '90' } })
    fireEvent.blur(slider)
    expect(input).toHaveValue('01:30')
    expect(timeline.getCommittedSnapshot()).toBe(90)
  })
})
