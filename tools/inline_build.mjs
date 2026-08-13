#!/usr/bin/env node
// Collapse a Vite dist/ build into ONE self-contained HTML file.
//
// Why: Claude Artifacts serve a single HTML page under a strict CSP that blocks every
// external request — no separate JS/CSS files, no image fetches. So scripts, styles and
// every sprite have to be inlined as data: URIs before the game can run there.
//
// Usage: node inline-build.mjs <distDir> <outFile>

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative, extname } from 'node:path'

const [, , distDir = 'dist', outFile = 'game-standalone.html'] = process.argv

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.woff2': 'font/woff2',
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

function dataURI(file) {
  const mime = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream'
  return `data:${mime};base64,${readFileSync(file).toString('base64')}`
}

if (!existsSync(distDir)) {
  console.error(`No build found at ${distDir} — run \`npm run build\` first.`)
  process.exit(1)
}

const files = walk(distDir)
let html = readFileSync(join(distDir, 'index.html'), 'utf8')

// Binary assets (sprites, audio, fonts) -> data: URIs, keyed by every path form the
// bundle might reference them by ("/sprites/x.png", "./sprites/x.png", "sprites/x.png").
const assetMap = new Map()
for (const f of files) {
  const ext = extname(f).toLowerCase()
  if (['.html', '.js', '.css', '.map'].includes(ext)) continue
  const rel = relative(distDir, f).split('\\').join('/')
  const uri = dataURI(f)
  assetMap.set('/' + rel, uri)
  assetMap.set('./' + rel, uri)
  assetMap.set(rel, uri)
}

// Sprite textures are requested at runtime from a template-built URL, so there is no literal
// string in the bundle to rewrite. Hand them over as a name -> data: URI map instead;
// src/render/assets.ts prefers `globalThis.__SPRITE_DATA__` when it is present.
const spriteData = {}
for (const f of files) {
  const rel = relative(distDir, f).split('\\').join('/')
  const m = /^sprites\/(.+)\.png$/.exec(rel)
  if (m) spriteData[m[1]] = dataURI(f)
}
const spriteScript = `<script>globalThis.__SPRITE_DATA__=${JSON.stringify(spriteData)}</script>`

// Longest-first so "/sprites/enemy_01.png" is replaced before any shorter prefix of it.
const keys = [...assetMap.keys()].sort((a, b) => b.length - a.length)
const inlineRefs = (text) => {
  for (const k of keys) text = text.split(k).join(assetMap.get(k))
  return text
}

// Inline <script src> and <link rel=stylesheet>, rewriting asset refs inside each.
html = html.replace(
  /<script\b([^>]*?)\ssrc=["']([^"']+)["']([^>]*)><\/script>/g,
  (whole, pre, src, post) => {
    const f = join(distDir, src.replace(/^[./]+/, ''))
    if (!existsSync(f)) return whole
    const attrs = `${pre} ${post}`.replace(/\bcrossorigin\b/g, '').trim()
    return `<script ${attrs}>\n${inlineRefs(readFileSync(f, 'utf8'))}\n</script>`
  },
)

html = html.replace(
  /<link\b[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/g,
  (whole, href) => {
    const f = join(distDir, href.replace(/^[./]+/, ''))
    if (!existsSync(f)) return whole
    return `<style>\n${inlineRefs(readFileSync(f, 'utf8'))}\n</style>`
  },
)

// Drop things that cannot work under the Artifact CSP / single-file context.
html = html
  .replace(/<link\b[^>]*rel=["']manifest["'][^>]*>/g, '')
  .replace(/<link\b[^>]*rel=["'](?:modulepreload|preload)["'][^>]*>/g, '')

html = inlineRefs(html)

// Must execute BEFORE the module script that boots the game and loads textures.
html = html.replace(/<script\b/, `${spriteScript}<script`)

writeFileSync(outFile, html)

const mb = (Buffer.byteLength(html) / 1024 / 1024).toFixed(2)
console.log(`Wrote ${outFile} (${mb} MB, ${assetMap.size / 3} assets inlined)`)
if (Number(mb) > 16) console.error('WARNING: over the 16MB Artifact limit — trim sprites.')
const leftover = html.match(/(?:src|href)=["'](?!data:|#|https?:)[^"']+["']/g)
if (leftover) console.error('WARNING: unresolved external refs:', [...new Set(leftover)].slice(0, 10))
