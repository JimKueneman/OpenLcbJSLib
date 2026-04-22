#!/usr/bin/env node
//
// Bundle builder for OpenLcbJSLib.
//
// Produces a self-contained IIFE bundle so the library can be consumed as a
// classic <script src="..."> tag — no module fetches, no dev server, works
// from file:// when an example folder is copied to disk.
//
// What it does on each run:
//   1. Build the "library" bundle from src/index.js into dist/openlcb.bundle.js
//      (and dist/openlcb.bundle.min.js when --minify is passed).
//   2. Copy the resulting bundle into every examples/<name>/ directory so the
//      example's HTML can <script src="openlcb.bundle.js"> locally, and the
//      whole example folder is a self-contained unit that a user can copy
//      elsewhere and double-click.
//
// Flags:
//   --minify     also emit a minified bundle (.min.js) alongside the readable one
//   --sourcemap  emit a sourcemap next to each bundle (for debugging)
//
// Usage:
//   node tools/build-bundles.mjs
//   node tools/build-bundles.mjs --minify
//   npm run build

import { build } from 'esbuild';
import { mkdir, readdir, copyFile, stat, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SRC_ENTRY = join(ROOT, 'src', 'index.js');
const DIST_DIR = join(ROOT, 'dist');
const EXAMPLES_DIR = join(ROOT, 'examples');
const GLOBAL_NAME = 'OpenLCB';

const flags = new Set(process.argv.slice(2));
const wantMinify = flags.has('--minify');
const wantSourcemap = flags.has('--sourcemap');

async function readVersion() {
    const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
    return pkg.version ?? '0.0.0';
}

async function ensureDir(path) {
    await mkdir(path, { recursive: true });
}

async function buildOne({ outfile, minify }) {
    const version = await readVersion();
    await build({
        entryPoints: [SRC_ENTRY],
        outfile,
        bundle: true,
        format: 'iife',
        globalName: GLOBAL_NAME,
        platform: 'browser',
        target: ['es2020'],
        minify,
        sourcemap: wantSourcemap,
        legalComments: 'none',
        banner: {
            js: `/* OpenLcbJSLib v${version} — https://github.com/... — generated bundle, do not edit by hand */`,
        },
    });
}

async function listExampleDirs() {
    let entries;
    try {
        entries = await readdir(EXAMPLES_DIR, { withFileTypes: true });
    } catch (e) {
        if (e.code === 'ENOENT') return [];
        throw e;
    }
    return entries.filter((e) => e.isDirectory()).map((e) => join(EXAMPLES_DIR, e.name));
}

async function fanOutToExamples(sourcePath, filename) {
    const dirs = await listExampleDirs();
    for (const dir of dirs) {
        const dest = join(dir, filename);
        await copyFile(sourcePath, dest);
        if (wantSourcemap) {
            const mapSrc = sourcePath + '.map';
            const mapDest = dest + '.map';
            try {
                await stat(mapSrc);
                await copyFile(mapSrc, mapDest);
            } catch { /* no sourcemap, skip */ }
        }
        console.log(`  → ${dest}`);
    }
}

async function main() {
    await ensureDir(DIST_DIR);

    const readable = join(DIST_DIR, 'openlcb.bundle.js');
    console.log(`Building ${readable}`);
    await buildOne({ outfile: readable, minify: false });
    await fanOutToExamples(readable, 'openlcb.bundle.js');

    if (wantMinify) {
        const minified = join(DIST_DIR, 'openlcb.bundle.min.js');
        console.log(`Building ${minified}`);
        await buildOne({ outfile: minified, minify: true });
        await fanOutToExamples(minified, 'openlcb.bundle.min.js');
    }

    console.log('Done.');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
