import { memo, useEffect, useRef, useState } from 'react'
import type {
  MapBounds,
  MapView,
  Placement,
  PlacementScene,
} from '@/lib/placement-scene'
import type { RecordingTimeline } from '@/lib/recording-timeline'

export type CanvasPlacementsProps = {
  placements: Placement[]
  bounds: MapBounds
  view: MapView
  version: number
  timeline?: RecordingTimeline
  colorByTime?: boolean
}

export const CanvasPlacements = memo(function CanvasPlacements(
  props: CanvasPlacementsProps,
) {
  const host = useRef<HTMLDivElement>(null)
  const scene = useRef<PlacementScene | null>(null)
  const latest = useRef(props)
  latest.current = props
  const [error, setError] = useState(false)
  useEffect(() => {
    const node = host.current!
    const controller = new AbortController()
    let observer: ResizeObserver | undefined
    void import('@/lib/canvas-placement-scene')
      .then(({ createPlacementScene }) =>
        createPlacementScene(node, controller.signal),
      )
      .then((renderer) => {
        if (!renderer) return
        if (controller.signal.aborted) {
          renderer.destroy()
          return
        }
        scene.current = renderer
        const { placements, version, bounds, view, timeline, colorByTime } =
          latest.current
        renderer.setPlacements(placements, version)
        renderer.setViewport(bounds, view)
        renderer.setTime(timeline?.getSnapshot() ?? Infinity, !!colorByTime)
        const resize = () => {
          const rect = node.getBoundingClientRect()
          renderer.resize(rect.width, rect.height)
        }
        observer = new ResizeObserver(resize)
        observer.observe(node)
        resize()
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true)
      })
    return () => {
      controller.abort()
      observer?.disconnect()
      scene.current?.destroy()
      scene.current = null
    }
  }, [])
  useEffect(() => {
    scene.current?.setPlacements(props.placements, props.version)
  }, [props.placements, props.version])
  useEffect(() => {
    scene.current?.setViewport(props.bounds, props.view)
  }, [props.bounds, props.view])
  useEffect(() => {
    const update = () =>
      scene.current?.setTime(
        props.timeline?.getSnapshot() ?? Infinity,
        !!props.colorByTime,
      )
    update()
    return props.timeline?.subscribe(update)
  }, [props.timeline, props.colorByTime])
  return (
    <>
      <div
        ref={host}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden rounded-md"
      />
      {error && (
        <p
          role="status"
          className="pointer-events-none absolute inset-x-2 bottom-2 rounded bg-background/90 p-2 text-sm"
        >
          Map rendering is unavailable. Build records are still available in
          the list.
        </p>
      )}
    </>
  )
})
