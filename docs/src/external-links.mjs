/**
 * Sätteri port of `rehype-external-links` with the options we used: absolute
 * http(s) and protocol-relative links get `rel="nofollow"` and open in a new tab.
 */

const EXTERNAL_RE = /^(?:https?:)?\/\//i

/** @type {import('@astrojs/markdown-satteri').SatteriProcessorOptions['hastPlugins'][number]} */
export const externalLinks = {
  name: 'external-links',
  element: {
    filter: ['a'],
    visit(node, ctx) {
      const href = node.properties.href
      if (typeof href !== 'string' || !EXTERNAL_RE.test(href)) return
      ctx.setProperty(node, 'rel', ['nofollow'])
      ctx.setProperty(node, 'target', '_blank')
    },
  },
}
