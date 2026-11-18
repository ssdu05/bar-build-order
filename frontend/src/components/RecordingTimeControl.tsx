import { useEffect, useState } from 'react'
import {
  useRecordingTime,
  type RecordingTimeline,
} from '@/lib/recording-timeline'
import { timeLabel } from '@/lib/replays'
import { Input } from './ui/input'
import { Label } from './ui/label'

function parseTime(text: string) {
  const value = text.trim()
  if (!/^\d+(?::[0-5]\d)?(?:\.\d+)?$/.test(value)) return null
  const seconds = value
    .split(':')
    .reduce((total, part) => total * 60 + Number(part), 0)
  return Number.isFinite(seconds) ? seconds : null
}

export function RecordingTimeControl({
  timeline,
  maximum,
  id,
  label,
  className = 'field text-xs',
}: {
  timeline: RecordingTimeline
  maximum: number
  id: string
  label?: string
  className?: string
}) {
  const value = useRecordingTime(timeline)
  const [draft, setDraft] = useState<string | null>(null)
  const applyTime = () => {
    if (draft !== null) {
      const seconds = parseTime(draft)
      if (seconds !== null) {
        timeline.preview(seconds)
        timeline.commit()
      }
    }
    setDraft(null)
  }
  useEffect(() => {
    // Native range dragging can finish outside the input.
    const finishPointer = () => timeline.end('pointer')
    const finishKey = () => timeline.end('keyboard')
    window.addEventListener('pointerup', finishPointer)
    window.addEventListener('pointercancel', finishPointer)
    window.addEventListener('keyup', finishKey)
    return () => {
      window.removeEventListener('pointerup', finishPointer)
      window.removeEventListener('pointercancel', finishPointer)
      window.removeEventListener('keyup', finishKey)
    }
  }, [timeline])
  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor={`${id}-time`}>
          Construction / production starts through
        </Label>
        <Input
          id={`${id}-time`}
          aria-label={`${label ?? 'Construction / production starts through'} time`}
          aria-invalid={draft !== null && parseTime(draft) === null}
          className="h-8 w-24 tabular-nums"
          value={draft ?? timeLabel(value)}
          placeholder="m:ss"
          title="Enter minutes:seconds (m:ss) or seconds. Press Enter or leave the field to apply."
          onFocus={(event) => event.target.select()}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={applyTime}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              applyTime()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              setDraft(null)
            }
          }}
        />
      </div>
      <Input
        id={id}
        aria-label={label ?? 'Construction / production starts through'}
        type="range"
        min={0}
        max={maximum}
        step="any"
        value={value}
        onPointerDown={() => timeline.begin()}
        onKeyDown={(event) => {
          if ([
            'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
            'Home', 'End', 'PageUp', 'PageDown',
          ].includes(event.key))
            timeline.begin('keyboard')
        }}
        onBlur={() => timeline.commit()}
        onChange={(event) => timeline.preview(Number(event.target.value))}
      />
    </div>
  )
}
