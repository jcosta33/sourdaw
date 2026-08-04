import { describe, it, expect } from 'vitest';

import { resolveFrozenBufferTail, UNKNOWN_FROZEN_TAIL_SECONDS } from '../frozenBufferTail';

describe('resolveFrozenBufferTail — known tail', () => {
    it('returns known seconds for a finite non-negative value', () => {
        expect(resolveFrozenBufferTail({ tailLengthSeconds: 3.5 })).toEqual({ known: true, seconds: 3.5 });
    });

    it('returns known seconds for zero (boundary: zero is valid)', () => {
        expect(resolveFrozenBufferTail({ tailLengthSeconds: 0 })).toEqual({ known: true, seconds: 0 });
    });

    it('returns known seconds for a large value', () => {
        expect(resolveFrozenBufferTail({ tailLengthSeconds: 100 })).toEqual({ known: true, seconds: 100 });
    });
});

describe('resolveFrozenBufferTail — unknown tail (never resolves to zero)', () => {
    it('returns unknown for undefined (missing field)', () => {
        expect(resolveFrozenBufferTail(undefined)).toEqual({
            known: false,
            atLeastSeconds: UNKNOWN_FROZEN_TAIL_SECONDS,
        });
    });

    it('returns unknown for a missing tailLengthSeconds key', () => {
        expect(resolveFrozenBufferTail({})).toEqual({ known: false, atLeastSeconds: UNKNOWN_FROZEN_TAIL_SECONDS });
    });

    it('returns unknown for NaN', () => {
        expect(resolveFrozenBufferTail({ tailLengthSeconds: Number.NaN })).toEqual({
            known: false,
            atLeastSeconds: UNKNOWN_FROZEN_TAIL_SECONDS,
        });
    });

    it('returns unknown for Infinity', () => {
        expect(resolveFrozenBufferTail({ tailLengthSeconds: Number.POSITIVE_INFINITY })).toEqual({
            known: false,
            atLeastSeconds: UNKNOWN_FROZEN_TAIL_SECONDS,
        });
    });

    it('returns unknown for -Infinity', () => {
        expect(resolveFrozenBufferTail({ tailLengthSeconds: Number.NEGATIVE_INFINITY })).toEqual({
            known: false,
            atLeastSeconds: UNKNOWN_FROZEN_TAIL_SECONDS,
        });
    });

    it('returns unknown for a negative number (never launders to zero)', () => {
        expect(resolveFrozenBufferTail({ tailLengthSeconds: -5 })).toEqual({
            known: false,
            atLeastSeconds: UNKNOWN_FROZEN_TAIL_SECONDS,
        });
    });
});

describe('resolveFrozenBufferTail — atLeastSeconds is the documented floor (24)', () => {
    it('UNKNOWN_FROZEN_TAIL_SECONDS is 24', () => {
        expect(UNKNOWN_FROZEN_TAIL_SECONDS).toBe(24);
    });
});
