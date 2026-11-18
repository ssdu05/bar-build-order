import { createRoot } from 'react-dom/client'
import type { Library } from '../src/hooks/use-library'
import { BuildOrderTable } from '../src/components/RecordedBuildOrder'
import { parseRecording } from '../src/lib/recording'
import { csvFor, entriesFixture, recording, url } from '../src/test/fixtures'
import '../src/index.css'

// Synthetic data only. This page does not read or modify the user's library.
const source = {
  ...recording,
  csv: csvFor(...Array.from({ length: 8000 }, (_, index) => ({
    player: index % 2 ? 'Alice' : 'Bob',
    team_id: String(index % 2),
    building: `Building ${index % 100}`,
    unit_id: String(index + 1),
    unit_def_id: String(index % 100 + 1),
    builder_id: String(index % 16 + 9000),
    start_seconds: String(index + 1),
    x: String(50 + index * 137 % 7000),
    z: String(50 + index * 293 % 7000),
  }))),
}
createRoot(document.getElementById('root')!).render(
  <div style={{ height: '100vh', display: 'flex' }}>
    <BuildOrderTable
      rows={parseRecording(source.csv)}
      recording={source}
      entry={entriesFixture()[url]}
      url={url}
      library={{ assets: { dataUpdatedAt: 1 }, refreshAssets: {} } as Library}
      onFilter={() => {}}
      preferences={{ kind: '', summarize: true, view: 'timeline' }}
      setPreferences={() => {}}
    />
  </div>,
)

Object.assign(window, {
  async runRecordingScrubBenchmark() {
    const slider = document.querySelector<HTMLInputElement>('#build-time')!
    const list = document.querySelector('.recording-list-pane')!
    const page = () => list.lastElementChild?.textContent
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    const waitForPage = (count: number) => new Promise<void>((resolve) => {
      const ready = () => {
        if (!page()?.includes(`Page 1 / ${count}`)) return
        observer.disconnect()
        resolve()
      }
      const observer = new MutationObserver(ready)
      observer.observe(list, { childList: true, subtree: true, characterData: true })
      ready()
    })
    set.call(slider, '8000')
    slider.dispatchEvent(new Event('input', { bubbles: true }))
    slider.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
    await waitForPage(40)
    const initialPage = page()
    const inputTimes: number[] = []
    const frameTimes: number[] = []
    let listStayedCommitted = true
    slider.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    let previous = performance.now()
    for (let index = 0; index < 60; index++) {
      await new Promise(requestAnimationFrame)
      const now = performance.now()
      frameTimes.push(now - previous)
      previous = now
      const started = performance.now()
      set.call(slider, String(index === 59 ? 4000 : 6000 + index % 20 * 100))
      slider.dispatchEvent(new Event('input', { bubbles: true }))
      await Promise.resolve()
      inputTimes.push(performance.now() - started)
      listStayedCommitted &&= page() === initialPage
    }
    const pending = document.querySelector('.recording-list-pane p[role=status]')?.textContent
    const commitStarted = performance.now()
    slider.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
    await waitForPage(20)
    const listCommitMs = performance.now() - commitStarted
    const percentile = (values: number[], percent: number) =>
      values.sort((a, b) => a - b)[Math.floor((values.length - 1) * percent)]
    return {
      records: 8000,
      clusteringEnabled: document.querySelector<HTMLInputElement>(
        'input[aria-label="Cluster nearby placements"]',
      )?.checked ?? false,
      inputMedianMs: percentile(inputTimes, 0.5),
      inputP95Ms: percentile(inputTimes, 0.95),
      frameMedianMs: percentile(frameTimes, 0.5),
      frameP95Ms: percentile(frameTimes, 0.95),
      listStayedCommittedDuringDrag: listStayedCommitted,
      listCommitMs,
      previewStatus: pending,
      finalPage: page(),
      mountedRows: list.querySelectorAll('tbody tr').length,
      map: document.querySelector('svg[aria-description]')?.getAttribute('aria-description'),
    }
  },
})
