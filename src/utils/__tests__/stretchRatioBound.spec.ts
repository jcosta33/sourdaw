import { describe, expect, it } from 'vitest';

import { boundStretchRatio } from '../stretchRatioBound';

/**
 * The law half of the #2532 stretch-ratio conformance gate. Do not delete
 * without replacing.
 *
 * `boundStretchRatio` is the single kernel both runtimes route through — the
 * live scheduler (`scheduleAudioClips`) and the offline projector
 * (`projectOfflineAudioClipPlaybacks`). Sharing the function makes live ==
 * offline by construction, but only while both sides keep routing through it;
 * the sibling conformance specs (Transport `scheduling` and AudioEngine
 * `offlineRender` `stretchRatioBoundConformance.spec.ts`) pin that routing,
 * and this spec pins the law itself: each row's expected value is the one
 * rate the law may produce, so a behavioural change to the kernel trips here
 * even if both sides move together — which would silently change how every
 * saved project with an out-of-range ratio plays back and bounces, not a
 * refactor.
 */

describe('boundStretchRatio — the shared stretch-ratio bound law', () => {
    it.each([
        // Corrupt lows: a persisted 0 or negative ratio must not reach a
        // divisor or `playbackRate`; it floors to the slowest schedulable rate.
        { name: 'zero', raw: 0, expected: 0.01 },
        { name: 'negative', raw: -2, expected: 0.01 },
        { name: 'below the floor', raw: 0.005, expected: 0.01 },
        { name: 'the floor itself', raw: 0.01, expected: 0.01 },
        // In-range ratios pass through untouched.
        { name: 'unity', raw: 1, expected: 1 },
        { name: 'double speed', raw: 2, expected: 2 },
        { name: 'just under the ceiling', raw: 99, expected: 99 },
        { name: 'the ceiling itself', raw: 100, expected: 100 },
        // Corrupt highs: a stem-import or AI-authored ratio past the ceiling
        // must not reach `playbackRate` as-is.
        { name: 'past the ceiling', raw: 1000, expected: 100 },
        { name: 'positive infinity', raw: Number.POSITIVE_INFINITY, expected: 100 },
        { name: 'negative infinity', raw: Number.NEGATIVE_INFINITY, expected: 0.01 },
    ])('bounds $name ($raw) to $expected', ({ raw, expected }) => {
        expect(boundStretchRatio(raw)).toBe(expected);
    });

    it('keeps every finite raw value inside [0.01, 100]', () => {
        for (let raw = -5; raw <= 200; raw += 0.5) {
            const bounded = boundStretchRatio(raw);
            expect(bounded, `raw ${raw}`).toBeGreaterThanOrEqual(0.01);
            expect(bounded, `raw ${raw}`).toBeLessThanOrEqual(100);
        }
    });
});
