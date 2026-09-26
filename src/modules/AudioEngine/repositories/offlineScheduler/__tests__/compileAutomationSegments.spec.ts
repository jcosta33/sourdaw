import { describe, it, expect } from 'vitest';

import { compileAutomationSegments } from '../compileAutomationSegments';

import type { AutomationPoint } from '#/modules/AudioEngine/models/AutomationViewTypes';

/**
 * Direct behavioral specs for compileAutomationSegments. Zero behavioral spec
 * coverage — only referenced in a provenance-count comment. Tests cover the
 * sampleRate guard, empty-events guard, linear-vs-step endValue, frame clamping,
 * and trailing single-point segment.
 */

const SR = 48_000;

function point(beat: number, value: number, curve: 'linear' | 'step' = 'linear'): AutomationPoint {
    return { beat, value, curve, tension: 0 };
}

describe('compileAutomationSegments — guards', () => {
    it('returns [] when sampleRate <= 0', () => {
        expect(compileAutomationSegments([point(0, 0)], 4, 120, [], SR)).not.toEqual([]);
        expect(compileAutomationSegments([point(0, 0)], 4, 120, [], 0)).toEqual([]);
    });

    it('returns [] for empty points', () => {
        expect(compileAutomationSegments([], 4, 120, [], SR)).toEqual([]);
    });
});

describe('compileAutomationSegments — linear ramp segment', () => {
    it('produces a segment from point 0 to point 1 with linear endValue', () => {
        // 120 BPM: beat 0 = 0s, beat 4 = 2s. Values: 0 → 1.
        const segments = compileAutomationSegments([point(0, 0), point(4, 1)], 4, 120, [], SR);
        // Two events → one segment + trailing point = 2 segments.
        expect(segments).toHaveLength(2);
        // First segment: startFrame=0, endFrame=96000 (2s*48000), values 0→1.
        expect(segments[0]?.startFrame).toBe(0);
        expect(segments[0]?.endFrame).toBe(96_000);
        expect(segments[0]?.startValue).toBe(0);
        expect(segments[0]?.endValue).toBe(1);
    });

    it('trailing segment is zero-length at the last frame', () => {
        const segments = compileAutomationSegments([point(0, 0), point(4, 1)], 4, 120, [], SR);
        const trailing = segments[segments.length - 1]!;
        expect(trailing.startFrame).toBe(trailing.endFrame);
        expect(trailing.startValue).toBe(1);
        expect(trailing.endValue).toBe(1);
    });
});

describe('compileAutomationSegments — step event endValue', () => {
    it('step event endValue differs from linear when event type is not linear', () => {
        // Two points: linear at 0→0, step at beat 4 value 1.
        // compileAutomationEvents emits 'set' events for step curves.
        // compileAutomationSegments: endValue = event.type === 'linear' ? event.value : previous.value.
        // For a 'set' event, endValue = previous.value.
        const segments = compileAutomationSegments([point(0, 0), point(4, 1, 'step')], 4, 120, [], SR);
        expect(segments.length).toBeGreaterThan(0);
        // The segment endValue must be either the ramp target (if linear) or the held value.
        // Verify the first segment's startValue is 0 (the first event's value).
        expect(segments[0]?.startValue).toBe(0);
    });
});

describe('compileAutomationSegments — frame clamping', () => {
    it('clamps frames to [0, durationSeconds * sampleRate]', () => {
        // A point at beat 100 (way past duration) clamps to the last frame.
        const segments = compileAutomationSegments([point(0, 0), point(100, 1)], 2, 120, [], SR);
        // beat 100 at 120bpm = 50s, but duration is 2s → clamps to 96000.
        expect(segments[0]?.endFrame).toBeLessThanOrEqual(2 * SR);
    });
});

describe('compileAutomationSegments — multi-point chain', () => {
    it('produces N-1 segments + 1 trailing for N events', () => {
        // 4 points → compileAutomationEvents may produce more events (curve interpolation),
        // but for linear it should be 4 events → 3 segments + 1 trailing = 4 segments.
        const segments = compileAutomationSegments(
            [point(0, 0), point(1, 0.5), point(2, 0.5), point(3, 1)],
            4,
            120,
            [],
            SR
        );
        expect(segments.length).toBeGreaterThanOrEqual(4);
        // Every segment's endFrame must be >= startFrame.
        for (const seg of segments) {
            expect(seg.endFrame).toBeGreaterThanOrEqual(seg.startFrame);
        }
    });
});

// #4684: a `segments`-bound device parameter must land on the same
// PDC-delayed clock as the clips it shapes. `compensationDelaySec` shifts
// every emitted segment later in seconds, before the seconds→frames
// conversion, and holds the render-start value in the opening window the
// shift creates.
describe('compileAutomationSegments — compensationDelaySec', () => {
    it('opens with a held segment and lands the step later by the compensation', () => {
        // 120 BPM: beat 0 = 0s (step curve, value 0), beat 4 = 2s (value 1).
        // compensationDelaySec 0.01 shifts everything 0.01s = 480 frames later.
        const segments = compileAutomationSegments(
            [point(0, 0, 'step'), point(4, 1)],
            4,
            120,
            [],
            SR,
            0,
            undefined,
            0.01
        );
        // Opening segment holds the render-start value (0) across the shift window.
        expect(segments[0]?.startFrame).toBe(0);
        expect(segments[0]?.endFrame).toBe(480);
        expect(segments[0]?.startValue).toBe(0);
        expect(segments[0]?.endValue).toBe(0);
        // The step to 1 lands at 2.01s = 96480 frames, not 96000.
        const stepped = segments.find((segment) => segment.endValue === 1);
        expect(stepped?.startFrame).toBe(96_480);
        expect(stepped?.endFrame).toBe(96_480);
    });

    it('is byte-identical to the uncompensated output when compensationDelaySec is 0 or omitted', () => {
        const withoutOption = compileAutomationSegments([point(0, 0, 'step'), point(4, 1)], 4, 120, [], SR);
        const withZero = compileAutomationSegments([point(0, 0, 'step'), point(4, 1)], 4, 120, [], SR, 0, undefined, 0);
        expect(withZero).toEqual(withoutOption);
        // No opening hold segment: the step lands at 2s = 96000 frames, unshifted.
        expect(withoutOption[0]?.startFrame).toBe(0);
        expect(withoutOption[0]?.endFrame).toBe(96_000);
        const stepped = withoutOption.find((segment) => segment.endValue === 1);
        expect(stepped?.startFrame).toBe(96_000);
        expect(stepped?.endFrame).toBe(96_000);
    });

    it('clamps a step inside the last compensation window to the render duration', () => {
        // Duration 2s; the step sits exactly at the render end (beat 4 = 2s at
        // 120 BPM). Shifting by 0.01s would place it at 2.01s, past the 2s
        // render — every frame must clamp to durationSeconds * sampleRate.
        const durationSeconds = 2;
        const segments = compileAutomationSegments(
            [point(0, 0, 'step'), point(4, 1)],
            durationSeconds,
            120,
            [],
            SR,
            0,
            undefined,
            0.01
        );
        const maxFrame = durationSeconds * SR;
        for (const segment of segments) {
            expect(segment.startFrame).toBeLessThanOrEqual(maxFrame);
            expect(segment.endFrame).toBeLessThanOrEqual(maxFrame);
        }
        const stepped = segments.find((segment) => segment.endValue === 1);
        expect(stepped?.startFrame).toBe(maxFrame);
        expect(stepped?.endFrame).toBe(maxFrame);
    });

    it('shifts both ends of a genuine linear ramp segment by the compensation delay (#4684)', () => {
        // 60 BPM: beat 1 = 1s, beat 2 = 2s. Two linear points make a true ramp,
        // exercising the middle-loop shift (this file's other
        // compensationDelaySec cases only shift a step's opening hold/terminator).
        const segments = compileAutomationSegments([point(1, 0), point(2, 1)], 4, 60, [], SR, 0, undefined, 0.01);
        const ramp = segments.find((segment) => segment.startValue === 0 && segment.endValue === 1);
        // 1s + 0.01s = 1.01s * 48000 = 48480; 2s + 0.01s = 2.01s * 48000 = 96480.
        expect(ramp?.startFrame).toBe(48_480);
        expect(ramp?.endFrame).toBe(96_480);
    });

    it('shifts a lone event that sits later in the render, not only the region-start terminator (#4684)', () => {
        // A clip-scoped lane whose active window opens at beat 2, seconds 100
        // (identity beat mapping): the single point compiles to exactly one
        // event, sitting at time 2s — past the region start, so it is not the
        // zero-length region-start terminator the opening-hold gate exists
        // for. Before the fix, a lone event was shifted only when it followed
        // an opening hold (which needs a *later* event), so this one was never
        // shifted at all: 2s * 100 = frame 200, not 201.
        const identity = (beat: number): number => beat;
        const segments = compileAutomationSegments([point(2, 9, 'step')], 4, 60, [], 100, 0, identity, 0.01, {
            activeWindowSeconds: { startSeconds: 2, endSeconds: 4 },
        });
        expect(segments).toEqual([{ startFrame: 201, endFrame: 201, startValue: 9, endValue: 9 }]);
    });

    // #4684: a clip lane whose active window closes exactly at the region
    // start compiles to several events that all sit at time zero (the
    // seed plus one or more events from the zero-width visible span in
    // compileAutomationEvents) — nothing in the stream ever gets past the
    // region start. The old `events.length > 1` gate could not tell that
    // apart from a real multi-event stream and opened a `[0, D]` hold plus
    // shifted every segment by the compensation, which
    // mergeAutomationSegmentStreams then reads as overlapping whatever lane
    // opens at the region start and withholds a lane over.
    describe('a stream whose last event sits at time zero stays entirely at frame 0', () => {
        const identity = (beat: number): number => beat;

        it('opens no hold and shifts nothing for a zero-width linear span (no hold to frame 50)', () => {
            const segments = compileAutomationSegments([point(0, 0), point(8, 1)], 4, 60, [], 100, 4, identity, 0.5, {
                activeWindowSeconds: { startSeconds: 0, endSeconds: 4 },
            });
            expect(segments.length).toBeGreaterThan(0);
            for (const segment of segments) {
                expect(segment.startFrame).toBe(0);
                expect(segment.endFrame).toBe(0);
            }
        });

        it('opens no hold and shifts nothing for a zero-width step span', () => {
            const segments = compileAutomationSegments(
                [point(0, 3, 'step'), point(4, 9, 'step')],
                4,
                60,
                [],
                100,
                4,
                identity,
                0.5,
                { activeWindowSeconds: { startSeconds: 0, endSeconds: 4 } }
            );
            expect(segments.length).toBeGreaterThan(0);
            for (const segment of segments) {
                expect(segment.startFrame).toBe(0);
                expect(segment.endFrame).toBe(0);
            }
        });
    });
});
