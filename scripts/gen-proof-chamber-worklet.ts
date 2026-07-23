#!/usr/bin/env node
/**
 * Generates src/modules/AudioEngine/wasm/proof_chamber.js from the wasm-pack output.
 *
 * Run automatically as part of `npm run wasm:proof-chamber`. Also run manually after
 * editing public/wasm/proof-chamber/proof_chamber.js during development.
 *
 * What this does:
 *  1. Reads public/wasm/proof-chamber/proof_chamber.js  (wasm-pack generated)
 *  2. Prepends AudioWorklet-scope polyfills for TextDecoder/TextEncoder/FinalizationRegistry
 *  3. Replaces `new URL('proof_chamber_bg.wasm', import.meta.url)` with a string path so
 *     Vite does not try to bundle the .wasm from src/ (it lives in public/ and is
 *     served statically). The async init() is never called from worklet processors —
 *     they always use initSync() with pre-fetched bytes.
 *  4. Copies the generated declarations beside the worklet glue.
 *  5. Writes to src/modules/AudioEngine/wasm/proof_chamber.js
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcFile = join(root, 'public/wasm/proof-chamber/proof_chamber.js');
const destFile = join(root, 'src/modules/AudioEngine/wasm/proof_chamber.js');
const srcTypes = join(root, 'public/wasm/proof-chamber/proof_chamber.d.ts');
const destTypes = join(root, 'src/modules/AudioEngine/wasm/proof_chamber.d.ts');

const polyfills = `\
// AudioWorklet scope lacks TextDecoder/TextEncoder — polyfill before wasm-bindgen glue loads
if (typeof TextDecoder === 'undefined') {
    globalThis.TextDecoder = class TextDecoder {
        decode(input) {
            if (!input) return '';
            const bytes = input instanceof Uint8Array ? input : new Uint8Array(
                input instanceof ArrayBuffer ? input : input.buffer,
                input instanceof ArrayBuffer ? 0 : input.byteOffset,
                input instanceof ArrayBuffer ? input.byteLength : input.byteLength,
            );
            let result = '';
            for (let i = 0; i < bytes.length; i++) {
                result += String.fromCharCode(bytes[i]);
            }
            return result;
        }
    };
}
if (typeof TextEncoder === 'undefined') {
    globalThis.TextEncoder = class TextEncoder {
        encode(input) {
            if (!input) return new Uint8Array(0);
            const buf = new Uint8Array(input.length);
            for (let i = 0; i < input.length; i++) {
                buf[i] = input.charCodeAt(i) & 0xff;
            }
            return buf;
        }
        encodeInto(src, dest) {
            const len = Math.min(src.length, dest.length);
            for (let i = 0; i < len; i++) {
                dest[i] = src.charCodeAt(i) & 0xff;
            }
            return { read: len, written: len };
        }
    };
}
if (typeof FinalizationRegistry === 'undefined') {
    globalThis.FinalizationRegistry = class FinalizationRegistry {
        register() {}
        unregister() {}
    };
}
`;

const generated = readFileSync(srcFile, 'utf8');

// Rewrite `new URL('proof_chamber_bg.wasm', import.meta.url)` to a served string path
// so Vite doesn't try to bundle the .wasm from src/ (it doesn't exist there — it lives
// in public/). `String.replace` silently no-ops when the needle is absent, so assert
// the wasm-bindgen async-init line matched exactly once; a wasm-bindgen output-format
// change must fail loudly here rather than ship the co-located _bg.wasm path (WB-3).
const needle = "module_or_path = new URL('proof_chamber_bg.wasm', import.meta.url);";
const replacement = "module_or_path = '/wasm/proof-chamber/proof_chamber_bg.wasm'; // served from public/";
const occurrences = generated.split(needle).length - 1;
if (occurrences !== 1) {
    throw new Error(
        `gen-proof-chamber-worklet: expected exactly 1 wasm-bindgen async-init URL line to rewrite, found ${occurrences}. ` +
            `The wasm-bindgen output format changed — update the needle in this script before regenerating.`
    );
}
const worklet = generated.split(needle).join(replacement);

writeFileSync(destFile, polyfills + worklet, 'utf8');
writeFileSync(destTypes, readFileSync(srcTypes, 'utf8'), 'utf8');
console.log(`✓ Generated ${destFile}`);
