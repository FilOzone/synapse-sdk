/**
 * Sätteri plugin that compiles ```mermaid fences to SVG at build time with Ondine,
 * so pages ship static diagrams instead of the Mermaid runtime. Colors come from
 * --ondine-* custom properties (see src/diagrams.css).
 */

import { RenderError, render } from 'ondine/compiler'

/** @type {import('ondine/compiler').Render.render.Options} */
const FIT_OPTIONS = {
  // Starlight's content column (--sl-content-width: 45rem)
  maxWidth: 720,
  // Turn left-to-right flowcharts top-to-bottom whenever they don't fit the column
  directionBreakpoint: 721,
}

/**
 * Narrowing a sequence diagram wraps its labels into overlapping notes, so those
 * keep their natural size and the figure scrolls sideways instead of shrinking
 * the text.
 *
 * @param {string} source
 * @param {string} idPrefix
 */
function renderDiagram(source, idPrefix) {
  const fitted = render(source, { ...FIT_OPTIONS, idPrefix })
  if (fitted.type !== 'sequence') return fitted.svg
  return render(source, { idPrefix, responsive: false }).svg
}

/** @type {import('@astrojs/markdown-satteri').SatteriProcessorOptions['mdastPlugins'][number]} */
export const mermaidDiagrams = {
  name: 'ondine-diagrams',
  code(node, ctx) {
    if (node.lang !== 'mermaid') return

    // Unique ids for accTitle/accDescr when a page has several diagrams
    ctx.data.ondineDiagrams = (ctx.data.ondineDiagrams ?? 0) + 1
    try {
      const svg = renderDiagram(node.value, `diagram-${ctx.data.ondineDiagrams}`)
      // A plain html node is emitted verbatim; Sätteri's rawHtml would escape braces for MDX
      return { type: 'html', value: `<figure class="diagram">${svg}</figure>` }
    } catch (error) {
      const where = ctx.fileURL ? ` in ${ctx.fileURL.pathname}` : ''
      if (error instanceof RenderError) throw new Error(`Invalid mermaid diagram${where}: ${error.message}`)
      throw error
    }
  },
}
