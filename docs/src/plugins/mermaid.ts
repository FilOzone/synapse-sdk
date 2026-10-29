import type { Element, Root } from 'hast'
import type { Root as MarkdownRoot } from 'mdast'
import rehypeMermaid from 'rehype-mermaid'
import { type Plugin, unified } from 'unified'
import { SKIP, visit } from 'unist-util-visit'

/** Keep diagram source out of the code highlighter, including in MDX. */
export const remarkMermaidBlocks: Plugin<[], MarkdownRoot> = () => (tree) => {
  visit(tree, 'code', (node, index, parent) => {
    if (node.lang !== 'mermaid' || index === undefined || parent === undefined) return
    const escaped = node.value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    parent.children[index] = {
      type: 'html',
      value: `<pre class="mermaid">${escaped}</pre>`,
      data: {
        hName: 'pre',
        hProperties: { className: ['mermaid'] },
        hChildren: [{ type: 'text', value: node.value }],
      },
    }
  })
}

/** Render both themes at build time; Starlight's theme selector controls which SVG is visible. */
export const rehypeMermaidThemes: Plugin<[], Root> = () => {
  const light = unified().use(rehypeMermaid, {
    prefix: 'mermaid-light',
    mermaidConfig: { theme: 'forest' },
  })
  const dark = unified().use(rehypeMermaid, {
    prefix: 'mermaid-dark',
    mermaidConfig: { theme: 'dark' },
  })

  return async (tree, file) => {
    const diagrams: { node: Element; parent: Root | Element; index: number }[] = []
    visit(tree, 'element', (node, index, parent) => {
      if (node.tagName !== 'pre' || index === undefined || parent === undefined) return
      const classes = node.properties.className
      if (!Array.isArray(classes) || !classes.includes('mermaid')) return
      diagrams.push({ node, parent, index })
      return SKIP
    })
    if (diagrams.length === 0) return

    const source: Root = { type: 'root', children: diagrams.map(({ node }) => node) }
    const [lightTree, darkTree] = await Promise.all([
      light.run(structuredClone(source), file),
      dark.run(structuredClone(source), file),
    ])

    for (const [index, diagram] of diagrams.entries()) {
      diagram.parent.children[diagram.index] = {
        type: 'element',
        tagName: 'div',
        properties: { className: ['mermaid-diagram'] },
        children: [
          {
            type: 'element',
            tagName: 'div',
            properties: { className: ['mermaid-light'] },
            children: [lightTree.children[index] as Element],
          },
          {
            type: 'element',
            tagName: 'div',
            properties: { className: ['mermaid-dark'] },
            children: [darkTree.children[index] as Element],
          },
        ],
      }
    }
  }
}
