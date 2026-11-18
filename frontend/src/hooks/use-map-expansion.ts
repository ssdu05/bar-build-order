import { useEffect, type RefObject } from 'react'

// Keep the same map mounted when expanded. Isolate its existing DOM subtree
// instead of portaling/remounting it and losing zoom, textures or selection.
export function useMapExpansion(
  expanded: boolean,
  root: RefObject<HTMLElement | null>,
  button: RefObject<HTMLButtonElement | null>,
  collapse: () => void,
) {
  useEffect(() => {
    if (!expanded || !root.current) return
    const node = root.current
    const siblings: {
      node: HTMLElement
      inert: boolean
      hidden: string | null
    }[] = []
    let branch: HTMLElement = node
    while (branch.parentElement) {
      for (const sibling of branch.parentElement.children) {
        if (sibling === branch || !(sibling instanceof HTMLElement)) continue
        siblings.push({
          node: sibling,
          inert: sibling.inert,
          hidden: sibling.getAttribute('aria-hidden'),
        })
        sibling.inert = true
        sibling.setAttribute('aria-hidden', 'true')
      }
      branch = branch.parentElement
      if (branch === document.body) break
    }
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    button.current?.focus({ preventScroll: true })
    const keyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        collapse()
      } else if (event.key === 'Tab') {
        const controls = [
          ...node.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), [tabindex="0"]',
          ),
        ].filter(
          (control) =>
            !control.closest('[hidden]') && control.getClientRects().length > 0,
        )
        const first = controls[0],
          last = controls.at(-1)
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last?.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first?.focus()
        }
      }
    }
    document.addEventListener('keydown', keyDown)
    return () => {
      document.removeEventListener('keydown', keyDown)
      document.body.style.overflow = overflow
      for (const { node: sibling, inert, hidden } of siblings) {
        sibling.inert = inert
        if (hidden === null) sibling.removeAttribute('aria-hidden')
        else sibling.setAttribute('aria-hidden', hidden)
      }
      if (button.current?.isConnected)
        button.current.focus({ preventScroll: true })
    }
  }, [expanded, root, button, collapse])
}
