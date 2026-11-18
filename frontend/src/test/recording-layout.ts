import { vi } from 'vitest'

// jsdom has no layout. Give the real virtualizer a viewport and measured rows
// rather than mocking it away, so scrolling/windowing is exercised in tests.
export function mockRecordingLayout() {
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(
    function (this: Element) {
      return this.getAttribute('aria-label') === 'Build-order records' ? 600 : 0
    },
  )
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(
    function (this: Element) {
      return this.getAttribute('aria-label') === 'Build-order records' ? 1000 : 0
    },
  )
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(
    function (this: HTMLElement) {
      return this.matches('tr[data-index]') ? 57 : 0
    },
  )
}
