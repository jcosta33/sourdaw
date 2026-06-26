import { describe, it, expect } from 'vitest';

import { compareIncrementalKeys } from '../compareIncrementalKeys';

const key = (millis: number, seq: number): string => `root:incremental:${millis}-${seq.toString(36)}`;

describe('compareIncrementalKeys', () => {
    it('orders chunks from different milliseconds by millis', () => {
        expect(compareIncrementalKeys(key(1_719_000_000_000, 0), key(1_719_000_000_001, 0))).toBeLessThan(0);
        expect(compareIncrementalKeys(key(1_719_000_000_002, 0), key(1_719_000_000_001, 0))).toBeGreaterThan(0);
    });

    it('breaks same-millisecond ties by the seq suffix (the bug the seq counter exists to fix)', () => {
        const millis = 1_719_000_000_000;
        // seq 0 < seq 1 < seq 35 — the old parseInt-on-tail comparator returned 0
        // for all of these (it stopped at the `-`), collapsing the tiebreaker.
        expect(compareIncrementalKeys(key(millis, 0), key(millis, 1))).toBeLessThan(0);
        expect(compareIncrementalKeys(key(millis, 1), key(millis, 0))).toBeGreaterThan(0);
        expect(compareIncrementalKeys(key(millis, 35), key(millis, 0))).toBeGreaterThan(0);
        expect(compareIncrementalKeys(key(millis, 7), key(millis, 7))).toBe(0);
    });

    it('decodes the base-36 seq, not a base-10 read of it', () => {
        const millis = 1_719_000_000_000;
        // seq 36 -> base36 "10", seq 9 -> "9". Base-10 misreads "10" as 10 < base-10
        // "9" only if parsed as decimal incorrectly; base-36 makes 36 > 9.
        expect(compareIncrementalKeys(key(millis, 36), key(millis, 9))).toBeGreaterThan(0);
    });

    it('produces a stable monotonic sort across a same-millisecond burst', () => {
        const millis = 1_719_000_000_000;
        const shuffled = [key(millis, 4), key(millis, 1), key(millis, 10), key(millis, 0), key(millis, 2)];
        const sorted = [...shuffled].sort(compareIncrementalKeys);
        expect(sorted).toEqual([key(millis, 0), key(millis, 1), key(millis, 2), key(millis, 4), key(millis, 10)]);
    });
});
