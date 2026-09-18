import { describe, expect, it } from 'vitest';

import { jsonValuesEqual, matchesJsonFingerprint } from '../jsonSemanticEquality';

describe('jsonValuesEqual', () => {
    it('compares JSON-normalized values independent of object key order', () => {
        expect(jsonValuesEqual({ alpha: 1, nested: { beta: 2 } }, { nested: { beta: 2 }, alpha: 1 })).toBe(true);
        expect(jsonValuesEqual({ nested: { beta: 2 } }, { nested: { beta: 3 } })).toBe(false);
        expect(jsonValuesEqual([{ id: 'first' }, { id: 'second' }], [{ id: 'second' }, { id: 'first' }])).toBe(false);
    });

    it('preserves JSON omission and root semantics', () => {
        expect(jsonValuesEqual({ deviceId: undefined }, {})).toBe(true);
        expect(jsonValuesEqual([undefined], [null])).toBe(true);
        expect(jsonValuesEqual(undefined, undefined)).toBe(true);
    });

    it('fails closed for values JSON cannot serialize', () => {
        expect(jsonValuesEqual(BigInt(1), BigInt(1))).toBe(false);
        const cyclic: { self?: unknown } = {};
        cyclic.self = cyclic;
        expect(jsonValuesEqual(cyclic, cyclic)).toBe(false);
    });
});

describe('matchesJsonFingerprint', () => {
    it('compares a live value with a JSON fingerprint using JSON semantics', () => {
        expect(matchesJsonFingerprint({ nested: { beta: 2 }, alpha: 1 }, '{"alpha":1,"nested":{"beta":2}}')).toBe(true);
        expect(matchesJsonFingerprint(undefined, 'null')).toBe(false);
        expect(matchesJsonFingerprint({ alpha: 1 }, 'not json')).toBe(false);
        expect(matchesJsonFingerprint(BigInt(1), '1')).toBe(false);
    });
});
