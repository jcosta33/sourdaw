import { describe, it, expect, beforeEach } from 'vitest';

import { AUTOMATCH_RELEASE_SECONDS, pendingAutoMatch } from '../autoMatchState';
import { makeKey } from '../makeKey';
import { resolveAutoMatchValue } from '../resolveAutoMatchValue';

const KEY = makeKey('t1', 'cutoff');

function armRelease(releasedValue: number): void {
    pendingAutoMatch.set(KEY, { releasedValue, startedAtSeconds: null });
}

function resolveAt(nowSeconds: number, automationValue = 1) {
    return resolveAutoMatchValue({ trackId: 't1', parameterId: 'cutoff', automationValue, nowSeconds });
}

describe('resolveAutoMatchValue', () => {
    beforeEach(() => {
        pendingAutoMatch.clear();
    });

    it('passes the curve value through untouched when no release is pending', () => {
        expect(resolveAt(10, 0.42)).toEqual({ value: 0.42, isReleaseStart: false });
    });

    it('holds at the released value on the first tick and flags the release start', () => {
        armRelease(0.2);

        expect(resolveAt(10)).toEqual({ value: 0.2, isReleaseStart: true });
    });

    it('stamps the glide start from the first tick it is observed, not from the release call', () => {
        armRelease(0.2);
        resolveAt(10);

        expect(pendingAutoMatch.get(KEY)?.startedAtSeconds).toBe(10);
    });

    it('blends linearly from the released value toward the curve across the ramp', () => {
        armRelease(0.2);
        resolveAt(10);

        // Quarter and half way through the ramp, toward a curve value of 1.
        expect(resolveAt(10 + AUTOMATCH_RELEASE_SECONDS * 0.25).value).toBeCloseTo(0.4, 10);
        expect(resolveAt(10 + AUTOMATCH_RELEASE_SECONDS * 0.5).value).toBeCloseTo(0.6, 10);
    });

    it('hands back the curve value and forgets the release once the ramp completes', () => {
        armRelease(0.2);
        resolveAt(10);

        expect(resolveAt(10 + AUTOMATCH_RELEASE_SECONDS)).toEqual({ value: 1, isReleaseStart: false });
        expect(pendingAutoMatch.has(KEY)).toBe(false);
    });

    it('flags the release start only once, so the smoother is re-seeded a single time', () => {
        armRelease(0.2);

        const first = resolveAt(10).isReleaseStart;
        const second = resolveAt(10 + AUTOMATCH_RELEASE_SECONDS * 0.25).isReleaseStart;

        expect([first, second]).toEqual([true, false]);
    });

    it('holds at the released value if the clock reads before the stamped start', () => {
        armRelease(0.2);
        resolveAt(10);

        expect(resolveAt(9).value).toBe(0.2);
    });

    it('leaves an unrelated parameter alone', () => {
        armRelease(0.2);

        expect(
            resolveAutoMatchValue({ trackId: 't1', parameterId: 'gain', automationValue: 0.9, nowSeconds: 10 })
        ).toEqual({ value: 0.9, isReleaseStart: false });
    });
});
