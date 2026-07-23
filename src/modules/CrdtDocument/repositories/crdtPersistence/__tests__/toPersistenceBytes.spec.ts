import { describe, it, expect } from 'vitest';

import { toPersistenceBytes } from '../toPersistenceBytes';

describe('toPersistenceBytes', () => {
    it('returns a Uint8Array copy for a Uint8Array input', () => {
        const input = new Uint8Array([1, 2, 3]);
        const result = toPersistenceBytes(input);
        expect(result).toBeInstanceOf(Uint8Array);
        expect(Array.from(result!)).toEqual([1, 2, 3]);
    });

    it('returns a new array (not the same reference)', () => {
        const input = new Uint8Array([1, 2, 3]);
        const result = toPersistenceBytes(input);
        expect(result).not.toBe(input);
    });

    it('returns null for a regular array of numbers', () => {
        expect(toPersistenceBytes([1, 2, 3])).toBeNull();
    });

    it('returns null for a number', () => {
        expect(toPersistenceBytes(42)).toBeNull();
    });

    it('returns null for null', () => {
        expect(toPersistenceBytes(null)).toBeNull();
    });

    it('returns null for undefined', () => {
        expect(toPersistenceBytes(undefined)).toBeNull();
    });

    it('returns null for an ArrayBuffer', () => {
        expect(toPersistenceBytes(new ArrayBuffer(8))).toBeNull();
    });

    it('returns null for a DataView', () => {
        expect(toPersistenceBytes(new DataView(new ArrayBuffer(4)))).toBeNull();
    });
});
