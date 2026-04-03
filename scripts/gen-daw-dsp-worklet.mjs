#!/usr/bin/env node
/**
 * Generates src/modules/AudioEngine/wasm/daw_dsp.js from the wasm-pack output.
 *
 * Run automatically as part of `npm run wasm:dsp`. Also run manually after
 * editing public/wasm/daw-dsp/daw_dsp.js during development.
 *
 * What this does:
 *  1. Reads public/wasm/daw-dsp/daw_dsp.js  (wasm-pack generated)
 *  2. Prepends AudioWorklet-scope polyfills for TextDecoder/TextEncoder/FinalizationRegistry
 *  3. Replaces `new URL('daw_dsp_bg.wasm', import.meta.url)` with a string path so
 *     Vite does not try to bundle the .wasm from src/ (it lives in public/ and is
 *     served statically). The async init() is never called from worklet processors —
 *     they always use initSync() with pre-fetched bytes.
 *  4. Writes to src/modules/AudioEngine/wasm/daw_dsp.js
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcFile = join(root, 'public/wasm/daw-dsp/daw_dsp.js');
const destFile = join(root, 'src/modules/AudioEngine/wasm/daw_dsp.js');

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

let generated = readFileSync(srcFile, 'utf8');

// Replace `new URL('daw_dsp_bg.wasm', import.meta.url)` so Vite doesn't try to
// bundle the .wasm from src/ (it doesn't exist there — it lives in public/).
generated = generated.replace(
    "module_or_path = new URL('daw_dsp_bg.wasm', import.meta.url);",
    "module_or_path = '/wasm/daw-dsp/daw_dsp_bg.wasm'; // served from public/",
);

writeFileSync(destFile, polyfills + generated, 'utf8');
console.log(`✓ Generated ${destFile}`);
