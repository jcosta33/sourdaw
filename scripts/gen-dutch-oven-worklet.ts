#!/usr/bin/env node
/**
 * Generates src/modules/AudioEngine/wasm/dutch_oven.js from the wasm-pack output.
 *
 * Run automatically as part of `npm run wasm:dutch-oven`. Also run manually after
 * editing public/wasm/dutch-oven/dutch_oven.js during development.
 *
 * What this does:
 *  1. Reads public/wasm/dutch-oven/dutch_oven.js  (wasm-pack generated)
 *  2. Prepends the shared AudioWorklet-scope polyfills for
 *     TextDecoder/TextEncoder/FinalizationRegistry (see workletPolyfills.ts)
 *  3. Replaces `new URL('dutch_oven_bg.wasm', import.meta.url)` with a string path so
 *     Vite does not try to bundle the .wasm from src/ (it lives in public/ and is
 *     served statically). The async init() is never called from worklet processors —
 *     they always use initSync() with pre-fetched bytes.
 *  4. Writes to src/modules/AudioEngine/wasm/dutch_oven.js
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

import { WORKLET_POLYFILLS } from './workletPolyfills.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcFile = join(root, 'public/wasm/dutch-oven/dutch_oven.js');
const destFile = join(root, 'src/modules/AudioEngine/wasm/dutch_oven.js');

let generated = readFileSync(srcFile, 'utf8');

generated = generated.replace(
    "module_or_path = new URL('dutch_oven_bg.wasm', import.meta.url);",
    "module_or_path = '/wasm/dutch-oven/dutch_oven_bg.wasm'; // served from public/"
);

writeFileSync(destFile, WORKLET_POLYFILLS + generated, 'utf8');
console.log(`✓ Generated ${destFile}`);
