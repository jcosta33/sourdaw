import { describe, it, expect } from 'vitest';

import * as subject from '../helpers';

describe('helpers', () => {
    it('should export createFlushHandlers', () => {
        expect(subject.createFlushHandlers).toBeDefined();
        const t = typeof subject.createFlushHandlers;
        expect(t === 'function' || t === 'object').toBe(true);
    });
    it('should export encodeCrustValue', () => {
        expect(subject.encodeCrustValue).toBeDefined();
        const t = typeof subject.encodeCrustValue;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});

describe('encodeCrustValue enum handling', () => {
    // Each enum-backed key maps a known string to its index. These guard the
    // happy path so the null-on-miss change below cannot silently break valid
    // encoding.
    it.each([
        ['style', 'punchy', 1],
        ['algorithm', 'aggressive', 4],
        ['satAlgorithm', 'tube', 3],
        ['multiBand', '5band', 2],
        ['stereoMode', 'ms', 1],
        ['dither', 'powr2', 4],
        ['scrollSpeed', 'fast', 2],
    ])('encodes known %s value %s to index %d', (key, value, expected) => {
        expect(subject.encodeCrustValue(key, value)).toBe(expected);
    });

    // Regression: an unrecognised enum string used to coerce to the first
    // valid index (`?? 0`, or `?? 1` for scrollSpeed), silently sending the
    // engine a wrong value while the store kept the bad string. It must now
    // return null so the write is skipped entirely.
    it.each([
        ['style', 'brutal'],
        ['algorithm', 'nonsense'],
        ['satAlgorithm', 'plasma'],
        ['multiBand', '7band'],
        ['stereoMode', 'quad'],
        ['dither', 'powr9'],
        ['scrollSpeed', 'glacial'],
    ])('returns null for an unknown %s value %s instead of coercing to a valid index', (key, value) => {
        expect(subject.encodeCrustValue(key, value)).toBeNull();
    });

    it('still encodes numbers and booleans directly', () => {
        expect(subject.encodeCrustValue('gain', 7.5)).toBe(7.5);
        expect(subject.encodeCrustValue('truePeak', true)).toBe(1);
        expect(subject.encodeCrustValue('satEnabled', false)).toBe(0);
    });
});
