import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const WEB_ROOT = path.resolve(__dirname, '..')
const CACHE_DIR = path.join(WEB_ROOT, '.ssg-cache')

const ENTRY_CONFIGS = [
  {
    source: path.join(WEB_ROOT, 'src', 'main.ts'),
    distHtml: path.join(WEB_ROOT, 'dist', 'index.html'),
    marker: '<!-- SSG:APP -->',
    exportName: 'renderHomePageSSG',
    cacheFile: path.join(CACHE_DIR, 'render-home.mjs'),
  },
  {
    source: path.join(WEB_ROOT, 'src', 'docs.ts'),
    distHtml: path.join(WEB_ROOT, 'dist', 'docs', 'index.html'),
    marker: '<!-- SSG:DOCS -->',
    exportName: 'renderDocsPageSSG',
    cacheFile: path.join(CACHE_DIR, 'render-docs.mjs'),
  },
]

function isInnerHtmlAssignmentStatement(node) {
  if (!ts.isExpressionStatement(node)) return false
  const expr = node.expression
  if (!ts.isBinaryExpression(expr)) return false
  if (expr.operatorToken.kind !== ts.SyntaxKind.FirstAssignment) return false
  if (!ts.isPropertyAccessExpression(expr.left)) return false
  return expr.left.name.text === 'innerHTML'
}

async function compileRendererModule({ source, exportName, cacheFile }) {
  const sourceText = await fs.readFile(source, 'utf8')
  const sf = ts.createSourceFile(source, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const assignmentStmt = sf.statements.find(isInnerHtmlAssignmentStatement)

  if (!assignmentStmt) {
    throw new Error(`Could not find top-level innerHTML assignment in ${source}`)
  }

  const binary = assignmentStmt.expression
  const rhsText = sourceText.slice(binary.right.pos, binary.right.end)
  const prefixText = sf.statements
    .filter((stmt) => stmt.pos < assignmentStmt.pos && !ts.isImportDeclaration(stmt))
    .map((stmt) => sourceText.slice(stmt.getFullStart(sf), stmt.end))
    .join('\n')

  const tsModule = `${prefixText}\n\nexport function ${exportName}() {\n  return ${rhsText}\n}\n`

  const transpiled = ts.transpileModule(tsModule, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
    },
    fileName: path.basename(source),
  }).outputText

  await fs.mkdir(path.dirname(cacheFile), { recursive: true })
  await fs.writeFile(cacheFile, transpiled, 'utf8')

  // Bust import cache by adding mtime-based query.
  const stat = await fs.stat(cacheFile)
  const moduleUrl = new URL(pathToFileURL(cacheFile).href)
  moduleUrl.searchParams.set('t', String(stat.mtimeMs))
  const mod = await import(moduleUrl.href)

  if (typeof mod[exportName] !== 'function') {
    throw new Error(`Export ${exportName} not found in generated module for ${source}`)
  }

  return mod[exportName]()
}

async function injectRenderedHtml(distHtmlPath, marker, renderedHtml) {
  let html = await fs.readFile(distHtmlPath, 'utf8')
  if (!html.includes(marker)) {
    throw new Error(`Marker ${marker} not found in ${distHtmlPath}`)
  }

  html = html.replace(marker, `\n${renderedHtml}\n`)
  await fs.writeFile(distHtmlPath, html, 'utf8')
}

async function main() {
  await fs.rm(CACHE_DIR, { recursive: true, force: true })
  try {
    for (const cfg of ENTRY_CONFIGS) {
      const renderedHtml = await compileRendererModule(cfg)
      await injectRenderedHtml(cfg.distHtml, cfg.marker, renderedHtml)
      console.log(`SSG rendered: ${path.relative(WEB_ROOT, cfg.distHtml)}`)
    }
  } finally {
    await fs.rm(CACHE_DIR, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error('[ssg] Failed:', error)
  process.exit(1)
})
