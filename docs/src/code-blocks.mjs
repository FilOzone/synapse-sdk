/**
 * Code block chrome for Astro's Shiki highlighter: a figure wrapper with an
 * optional title or terminal frame, a copy button, and a small client script
 * for copying and for positioning twoslash popups outside the scroll area.
 */

const TERMINAL_LANGS = new Set(['sh', 'bash', 'shell', 'zsh', 'console', 'powershell'])
const TITLE_RE = /(?:^|\s)title=(["'])(.*?)\1/

/**
 * @param {string} tagName
 * @param {Record<string, unknown>} properties
 * @param {any[]} children
 */
function h(tagName, properties, children = []) {
  return { type: 'element', tagName, properties, children }
}

// Built as hast rather than a raw string so MDX can compile it too
const copyIcon = () =>
  h(
    'svg',
    {
      ariaHidden: 'true',
      viewBox: '0 0 24 24',
      width: '16',
      height: '16',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: '2',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    },
    [
      h('rect', { x: '9', y: '9', width: '13', height: '13', rx: '2' }),
      h('path', { d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' }),
    ]
  )

/** @returns {import('shiki').ShikiTransformer} */
export function transformerCodeBlocks() {
  return {
    name: 'docs:code-blocks',
    root(root) {
      const pre = root.children.find((node) => node.type === 'element' && node.tagName === 'pre')
      if (!pre) return

      const lang = this.options.lang
      const title = this.options.meta?.__raw?.match(TITLE_RE)?.[2]
      const terminal = TERMINAL_LANGS.has(lang)
      const classes = ['code-block']
      if (terminal) classes.push('is-terminal')
      if (title) classes.push('has-title')

      const children = []
      if (terminal || title) {
        children.push(
          h('figcaption', { className: ['code-block-title'] }, title ? [{ type: 'text', value: title }] : [])
        )
      }
      children.push(pre)
      children.push(
        h('button', { type: 'button', className: ['code-block-copy'], title: 'Copy to clipboard' }, [
          copyIcon(),
          h('span', { className: ['sr-only'] }, [{ type: 'text', value: 'Copy to clipboard' }]),
        ])
      )

      root.children = [h('figure', { className: classes, dataLanguage: lang }, children)]
    },
  }
}

/** Runs in the browser. Serialized into an inline script, so it must be self-contained. */
function clientScript() {
  const POPUP_OVERLAP = 2
  const EDGE = 8

  document.addEventListener('click', async (event) => {
    const button = event.target instanceof Element ? event.target.closest('.code-block-copy') : null
    const code = button?.parentElement?.querySelector('pre code')
    if (!button || !code) return

    const clone = code.cloneNode(true)
    for (const node of clone.querySelectorAll(
      '.twoslash-popup-container, .twoslash-meta-line, .twoslash-error-line, .twoslash-tag-line'
    )) {
      node.remove()
    }
    await navigator.clipboard.writeText(clone.textContent ?? '')
    button.dataset.copied = ''
    setTimeout(() => delete button.dataset.copied, 1500)
  })

  // Popups are position: fixed so the scrolling <pre> cannot clip them. Starlight
  // isolates .main-pane, so they also have to stay inside it and below the header.
  // They overlap the token slightly so the pointer can move into a popup (to scroll
  // it) without leaving the hovered element and closing it.
  document.addEventListener('pointerover', (event) => {
    const hover =
      event.target instanceof Element ? event.target.closest('.twoslash-hover, .twoslash-error-hover') : null
    const popup = hover?.querySelector(':scope > .twoslash-popup-container')
    if (!hover || !(popup instanceof HTMLElement)) return
    // Moving within the token or its popup: keep the position and scroll offset
    if (event.relatedTarget instanceof Node && hover.contains(event.relatedTarget)) return

    const rect = hover.getBoundingClientRect()
    const pane = (hover.closest('.main-pane') ?? document.documentElement).getBoundingClientRect()
    const minLeft = Math.max(pane.left, 0) + EDGE
    const maxRight = Math.min(pane.right, document.documentElement.clientWidth) - EDGE
    const minTop = (document.querySelector('.header')?.getBoundingClientRect().bottom ?? 0) + EDGE

    popup.style.maxWidth = `${maxRight - minLeft}px`
    popup.style.maxHeight = ''
    popup.scrollTop = 0
    const height = popup.offsetHeight
    const below = rect.bottom - POPUP_OVERLAP
    const spaceBelow = window.innerHeight - EDGE - below
    const spaceAbove = rect.top + POPUP_OVERLAP - minTop
    const placeBelow = height <= spaceBelow || spaceBelow >= spaceAbove
    const maxHeight = Math.min(height, placeBelow ? spaceBelow : spaceAbove)

    popup.style.maxHeight = `${maxHeight}px`
    popup.style.left = `${Math.max(minLeft, Math.min(rect.left, maxRight - popup.offsetWidth))}px`
    popup.style.top = `${placeBelow ? below : rect.top + POPUP_OVERLAP - maxHeight}px`
  })
}

export const codeBlocksScript = `(${clientScript.toString()})()`
