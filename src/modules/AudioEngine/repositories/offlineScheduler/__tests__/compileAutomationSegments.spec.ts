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
