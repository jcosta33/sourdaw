/**
 * AudioWorklet scope lacks TextDecoder, TextEncoder, and FinalizationRegistry.
 * Import this module before any wasm-bindgen glue to ensure the polyfills are
 * installed. Because ES module imports are evaluated in order, placing this
 * import first guarantees the globals exist when the generated bindings run.
 */
if (typeof TextDecoder === 'undefined') {
    globalThis.TextDecoder = class TextDecoder {
        decode(input) {
            if (!input) return '';
            const bytes =
                input instanceof Uint8Array
                    ? input
                    : new Uint8Array(
                          input instanceof ArrayBuffer ? input : input.buffer,
                          input instanceof ArrayBuffer ? 0 : input.byteOffset,
                          input instanceof ArrayBuffer ? input.byteLength : input.byteLength
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
