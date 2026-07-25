import { describe, expect, it } from 'vitest';

import { WORKLET_POLYFILLS } from '../workletPolyfills.ts';

/**
 * WB-9.
 *
 * The polyfills ship as source text injected into the AudioWorklet realm, so the only
 * honest way to test them is to evaluate that exact text in a scope where the real
 * `TextDecoder`/`TextEncoder` are absent — which is what the worklet looks like — and
 * then compare against Node's built-in implementations.
 *
 * The previous implementation was latin1: `decode` did `String.fromCharCode(byte)` per
 * byte and `encode` masked `charCodeAt(i) & 0xff`. Every assertion below that involves a
 * character above U+007F failed against it, in both directions, with no error raised.
 */

type PolyfillScope = {
    TextDecoder: new (label?: string, options?: { fatal?: boolean }) => {
        decode: (input?: Uint8Array) => string;
    };
    TextEncoder: new () => {
        encode: (input: string) => Uint8Array;
        encodeInto: (src: string, dest: Uint8Array) => { read: number; written: number };
    };
    FinalizationRegistry: new () => { register: () => void; unregister: () => void };
};

/** Run the shipped polyfill text in a realm with no built-in text codecs. */
function loadPolyfills(): PolyfillScope {
    const scope = {} as PolyfillScope;
    const evaluate = new Function(
        'globalThis',
        'TextDecoder',
        'TextEncoder',
        'FinalizationRegistry',
        WORKLET_POLYFILLS
    );
    evaluate(scope, undefined, undefined, undefined);
    return scope;
}

/** Strings that a latin1 codec silently corrupts, one per UTF-8 sequence width. */
const SAMPLES: ReadonlyArray<readonly [string, string, number]> = [
    ['ascii only', 'eq_band3_freq', 1],
    ['two-byte latin', 'Präzision', 2],
    ['two-byte cyrillic', 'Тембр', 2],
    ['three-byte cjk', '低域補正', 3],
    ['three-byte symbol', 'gain ≥ −18 dB', 3],
    ['four-byte astral', 'level 🔊 peak', 4],
    ['mixed widths', 'Proof — 低域 🔊 ≥ 0 dB', 4],
];

describe('worklet text codec polyfills', () => {
    const { TextDecoder: PolyfillDecoder, TextEncoder: PolyfillEncoder } = loadPolyfills();

    describe.each(SAMPLES)('%s (%s)', (_label, sample, maxWidth) => {
        it('encodes to the same bytes as the platform encoder', () => {
            const actual = new PolyfillEncoder().encode(sample);
            const expected = new TextEncoder().encode(sample);
            expect(Array.from(actual)).toEqual(Array.from(expected));
        });

        it('decodes platform-encoded bytes back to the original string', () => {
            const bytes = new TextEncoder().encode(sample);
            expect(new PolyfillDecoder().decode(bytes)).toBe(sample);
        });

        it('round-trips through its own encoder and decoder', () => {
            const encoded = new PolyfillEncoder().encode(sample);
            expect(new PolyfillDecoder().decode(encoded)).toBe(sample);
        });

        it(`emits multi-byte sequences rather than one byte per character`, () => {
            const bytes = new PolyfillEncoder().encode(sample);
            // A latin1 encoder always produces exactly one byte per UTF-16 unit; for
            // every non-ASCII sample here UTF-8 must produce more.
            if (maxWidth > 1) {
                expect(bytes.length).toBeGreaterThan(sample.length);
            } else {
                expect(bytes.length).toBe(sample.length);
            }
        });
    });

    it('reports encodeInto counts that match the platform encoder', () => {
        const sample = 'Proof — 低域 🔊';
        const actualDest = new Uint8Array(64);
        const expectedDest = new Uint8Array(64);
        const actual = new PolyfillEncoder().encodeInto(sample, actualDest);
        const expected = new TextEncoder().encodeInto(sample, expectedDest);
        expect(actual).toEqual(expected);
        expect(Array.from(actualDest)).toEqual(Array.from(expectedDest));
    });

    it('never splits a multi-byte sequence when the destination runs out', () => {
        // wasm-bindgen sizes the destination at `length * 3` so this should not fire in
        // production, but a truncated sequence would corrupt the tail of a param name
        // rather than drop it, so the boundary behaviour is pinned.
        const sample = '低域補正';
        for (let capacity = 0; capacity <= 12; capacity++) {
            const dest = new Uint8Array(capacity);
            const { read, written } = new PolyfillEncoder().encodeInto(sample, dest);
            expect(written).toBe(3 * Math.floor(capacity / 3));
            expect(read).toBe(Math.floor(capacity / 3));
            // Whatever landed must decode cleanly back to the prefix it represents.
            expect(new PolyfillDecoder().decode(dest.subarray(0, written))).toBe(
                sample.slice(0, read)
            );
        }
    });

    it('decodes an empty or absent input to an empty string', () => {
        const decoder = new PolyfillDecoder();
        expect(decoder.decode()).toBe('');
        expect(decoder.decode(new Uint8Array(0))).toBe('');
    });

    it('substitutes U+FFFD for malformed input when not fatal', () => {
        // 0xC3 starts a two-byte sequence; on its own it is truncated.
        expect(new PolyfillDecoder().decode(new Uint8Array([0xc3]))).toBe('�');
        // 0x80 is a continuation byte with no lead.
        expect(new PolyfillDecoder().decode(new Uint8Array([0x80]))).toBe('�');
        // Overlong encoding of '/' — a classic path-traversal smuggling vector.
        expect(new PolyfillDecoder().decode(new Uint8Array([0xc0, 0xaf]))).toBe('�');
        // Surrogate half encoded as three bytes must not become a lone surrogate.
        expect(new PolyfillDecoder().decode(new Uint8Array([0xed, 0xa0, 0x80]))).toBe('�');
    });

    it('throws on malformed input when constructed fatal, as wasm-bindgen does', () => {
        // The generated glue constructs `new TextDecoder('utf-8', { ignoreBOM: true, fatal: true })`.
        const decoder = new PolyfillDecoder('utf-8', { fatal: true });
        expect(() => decoder.decode(new Uint8Array([0x80]))).toThrow(TypeError);
        expect(decoder.decode(new TextEncoder().encode('ok ✓'))).toBe('ok ✓');
    });

    it('still provides a no-op FinalizationRegistry', () => {
        const { FinalizationRegistry: PolyfillRegistry } = loadPolyfills();
        const registry = new PolyfillRegistry();
        expect(() => {
            registry.register();
            registry.unregister();
        }).not.toThrow();
    });
});
