/**
 * AudioWorklet-scope polyfills prepended to every generated wasm-bindgen glue file.
 *
 * The worklet global scope has no `TextDecoder`/`TextEncoder`/`FinalizationRegistry`,
 * but wasm-bindgen's glue uses all three: every `set_param(name, value)` call runs the
 * string through `TextEncoder.encodeInto`, and anything returning a `String` from Rust
 * comes back through `TextDecoder.decode`.
 *
 * WB-9: the previous implementation was latin1, not UTF-8 — `decode` did
 * `String.fromCharCode(byte)` per byte and `encode` masked `charCodeAt(i) & 0xff`.
 * Any code point above U+007F was silently corrupted in both directions: a two-byte
 * sequence decoded as two garbage characters, and a non-ASCII character encoded to a
 * single truncated byte. Nothing raised. These are real UTF-8 codecs.
 *
 * This module is the single source for all four gen scripts, which previously each
 * carried a byte-identical copy of the block.
 */

/**
 * Source text injected ahead of the wasm-bindgen glue. It is a string rather than real
 * code because it has to run inside the worklet realm, which has no module loader.
 */
export const WORKLET_POLYFILLS = `\
// AudioWorklet scope lacks TextDecoder/TextEncoder — polyfill before wasm-bindgen glue loads.
// These are UTF-8, not latin1 (WB-9): wasm-bindgen routes every string across the
// boundary through them, so a byte-wise codec corrupts any non-ASCII payload silently.
if (typeof TextDecoder === 'undefined') {
    globalThis.TextDecoder = class TextDecoder {
        constructor(label, options) {
            this.encoding = 'utf-8';
            this.fatal = Boolean(options && options.fatal);
            this.ignoreBOM = Boolean(options && options.ignoreBOM);
        }

        decode(input) {
            if (!input) {
                return '';
            }
            let bytes;
            if (input instanceof Uint8Array) {
                bytes = input;
            } else if (input instanceof ArrayBuffer) {
                bytes = new Uint8Array(input);
            } else {
                bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
            }

            const malformed = () => {
                if (this.fatal) {
                    throw new TypeError('TextDecoder: malformed UTF-8 sequence');
                }
                return '\\uFFFD';
            };

            let result = '';
            let i = 0;
            while (i < bytes.length) {
                const lead = bytes[i];
                let codePoint;
                let width;
                if (lead < 0x80) {
                    codePoint = lead;
                    width = 1;
                } else if ((lead & 0xe0) === 0xc0) {
                    codePoint = lead & 0x1f;
                    width = 2;
                } else if ((lead & 0xf0) === 0xe0) {
                    codePoint = lead & 0x0f;
                    width = 3;
                } else if ((lead & 0xf8) === 0xf0) {
                    codePoint = lead & 0x07;
                    width = 4;
                } else {
                    result += malformed();
                    i += 1;
                    continue;
                }

                if (i + width > bytes.length) {
                    result += malformed();
                    break;
                }

                let valid = true;
                for (let k = 1; k < width; k++) {
                    const continuation = bytes[i + k];
                    if ((continuation & 0xc0) !== 0x80) {
                        valid = false;
                        break;
                    }
                    codePoint = (codePoint << 6) | (continuation & 0x3f);
                }
                if (!valid) {
                    result += malformed();
                    i += 1;
                    continue;
                }
                i += width;

                // Reject overlong encodings, surrogates and out-of-range values, so a
                // malformed payload cannot smuggle a lone surrogate into a JS string.
                const overlong =
                    (width === 2 && codePoint < 0x80) ||
                    (width === 3 && codePoint < 0x800) ||
                    (width === 4 && codePoint < 0x10000);
                const surrogate = codePoint >= 0xd800 && codePoint <= 0xdfff;
                if (overlong || surrogate || codePoint > 0x10ffff) {
                    result += malformed();
                    continue;
                }

                if (codePoint <= 0xffff) {
                    result += String.fromCharCode(codePoint);
                } else {
                    const offset = codePoint - 0x10000;
                    result += String.fromCharCode(0xd800 + (offset >> 10), 0xdc00 + (offset & 0x3ff));
                }
            }
            return result;
        }
    };
}
if (typeof TextEncoder === 'undefined') {
    globalThis.TextEncoder = class TextEncoder {
        constructor() {
            this.encoding = 'utf-8';
        }

        encode(input) {
            if (!input) {
                return new Uint8Array(0);
            }
            // 3 bytes per UTF-16 unit is a hard upper bound: a BMP character costs at
            // most 3, and a surrogate pair costs 4 across 2 units.
            const buffer = new Uint8Array(input.length * 3);
            const { written } = this.encodeInto(input, buffer);
            return buffer.subarray(0, written);
        }

        encodeInto(src, dest) {
            let read = 0;
            let written = 0;
            while (read < src.length) {
                let codePoint = src.charCodeAt(read);
                let units = 1;
                if (codePoint >= 0xd800 && codePoint <= 0xdbff && read + 1 < src.length) {
                    const trail = src.charCodeAt(read + 1);
                    if (trail >= 0xdc00 && trail <= 0xdfff) {
                        codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (trail - 0xdc00);
                        units = 2;
                    }
                }
                // An unpaired surrogate is not encodable; WHATWG substitutes U+FFFD.
                if (codePoint >= 0xd800 && codePoint <= 0xdfff) {
                    codePoint = 0xfffd;
                }

                let width;
                if (codePoint < 0x80) {
                    width = 1;
                } else if (codePoint < 0x800) {
                    width = 2;
                } else if (codePoint < 0x10000) {
                    width = 3;
                } else {
                    width = 4;
                }
                // Never emit a partial sequence: stop on the character boundary so the
                // returned counts stay consistent with what landed in \`dest\`.
                if (written + width > dest.length) {
                    break;
                }

                if (width === 1) {
                    dest[written++] = codePoint;
                } else if (width === 2) {
                    dest[written++] = 0xc0 | (codePoint >> 6);
                    dest[written++] = 0x80 | (codePoint & 0x3f);
                } else if (width === 3) {
                    dest[written++] = 0xe0 | (codePoint >> 12);
                    dest[written++] = 0x80 | ((codePoint >> 6) & 0x3f);
                    dest[written++] = 0x80 | (codePoint & 0x3f);
                } else {
                    dest[written++] = 0xf0 | (codePoint >> 18);
                    dest[written++] = 0x80 | ((codePoint >> 12) & 0x3f);
                    dest[written++] = 0x80 | ((codePoint >> 6) & 0x3f);
                    dest[written++] = 0x80 | (codePoint & 0x3f);
                }
                read += units;
            }
            return { read, written };
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
