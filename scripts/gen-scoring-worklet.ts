#!/usr/bin/env node
/**
 * Generates src/modules/AudioEngine/wasm/scoring.js from the wasm-pack output.
 *
 * Run automatically as part of `npm run wasm:scoring`. Also run manually after
 * editing public/wasm/scoring/scoring.js during development.
 *
 * What this does:
 *  1. Reads public/wasm/scoring/scoring.js  (wasm-pack generated)
 *  2. Prepends the shared AudioWorklet-scope polyfills for
 *     TextDecoder/TextEncoder/FinalizationRegistry (see workletPolyfills.ts)
 *  3. Replaces `new URL('scoring_bg.wasm', import.meta.url)` with a string path so
 *     Vite does not try to bundle the .wasm from src/ (it lives in public/ and is
 *     served statically). The async init() is never called from worklet processors —
 *     they always use initSync() with pre-fetched bytes.
 *  4. Writes to src/modules/AudioEngine/wasm/scoring.js
 *  5. Mirrors the wasm-pack .d.ts into the worklet tree and stamps every
 *     generated declaration with the crate-source hash (WB-4 drift gate).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { wasmArtifacts } from './wasm-artifacts.ts';
import { WORKLET_POLYFILLS } from './workletPolyfills.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcFile = join(root, 'public/wasm/scoring/scoring.js');
const destFile = join(root, 'src/modules/AudioEngine/wasm/scoring.js');


const generated = readFileSync(srcFile, 'utf8');

// Rewrite `new URL('scoring_bg.wasm', import.meta.url)` to a served string path so
// Vite doesn't try to bundle the .wasm from src/ (it doesn't exist there — it lives
// in public/). `String.replace` silently no-ops when the needle is absent, so assert
// the wasm-bindgen async-init line matched exactly once; a wasm-bindgen output-format
// change must fail loudly here rather than ship the co-located _bg.wasm path (WB-3).
const needle = "module_or_path = new URL('scoring_bg.wasm', import.meta.url);";
const replacement = "module_or_path = '/wasm/scoring/scoring_bg.wasm'; // served from public/";
const occurrences = generated.split(needle).length - 1;
if (occurrences !== 1) {
    throw new Error(
        `gen-scoring-worklet: expected exactly 1 wasm-bindgen async-init URL line to rewrite, found ${occurrences}. ` +
            `The wasm-bindgen output format changed — update the needle in this script before regenerating.`
    );
}
const worklet = generated.split(needle).join(replacement);

writeFileSync(destFile, WORKLET_POLYFILLS + worklet, 'utf8');
wasmArtifacts.regenerateDeclarations('scoring');
console.log(`✓ Generated ${destFile} (+ stamped declarations)`);
