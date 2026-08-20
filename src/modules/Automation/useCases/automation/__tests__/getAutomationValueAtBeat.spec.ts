import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type AutomationLane, type AutomationPoint } from '../../../models/Automation';
import { automationStore } from '../../../stores/automationStore';
import { getAutomationValueAtBeat } from '../getAutomationValueAtBeat';

/**
 * Build a lane with the minimum required fields the value-at-beat resolver
 * touches. Points MUST stay sorted by beat (the binary search assumes it).
 */
function lane(id: string, points: AutomationPoint[], extra: Partial<AutomationLane> = {}): AutomationLane {
    return {
        id,
        trackId: 'track-1',
        parameterId: 'param-1',
        parameterName: 'Param',
        points,
        objects: [],
        visible: true,
        enabled: true,
        collapsed: false,
        minValue: 0,
        maxValue: 1,
        ...extra,
    };
}

function point(
    beat: number,
    value: number,
    curve: AutomationPoint['curve'] = 'linear',
    extra: Partial<AutomationPoint> = {}
): AutomationPoint {
    return { beat, value, curve, tension: 0, ...extra };
}

describe('getAutomationValueAtBeat — end-to-end interpolation (real algorithm)', () => {
    beforeEach(() => {
        automationStore.set({ lanes: [] });
    });
    afterEach(() => {
        automationStore.set({ lanes: [] });
    });

    it('returns null when the store has no value', () => {
        // The scheduler must skip a lane (return null) rather than drive the
        // parameter to a real 0 when the store is uninitialized.
        automationStore.set(null);
        expect(getAutomationValueAtBeat('any', 0)).toBeNull();
    });

    it('returns null when the lane id is not in the store', () => {
        automationStore.set({ lanes: [lane('exists', [point(0, 0.5)])] });
        expect(getAutomationValueAtBeat('missing', 0)).toBeNull();
    });

    it('returns null for an empty-points lane', () => {
        automationStore.set({ lanes: [lane('empty', [])] });
        expect(getAutomationValueAtBeat('empty', 4)).toBeNull();
    });

    it('returns the first point value when the beat is before all points', () => {
        automationStore.set({ lanes: [lane('l1', [point(5, 0.2), point(10, 0.5)])] });
        // Before the first point, the curve holds the first value (flat left
        // extension) — it must NOT extrapolate backwards.
        expect(getAutomationValueAtBeat('l1', 0)).toBeCloseTo(0.2, 10);
    });

    it('returns the last point value when the beat is after all points', () => {
        automationStore.set({ lanes: [lane('l1', [point(5, 0.2), point(10, 0.5)])] });
        // After the last point, the curve holds the last value (flat right
        // extension) — it must NOT extrapolate beyond the end.
        expect(getAutomationValueAtBeat('l1', 99)).toBeCloseTo(0.5, 10);
    });

    it('interpolates a linear segment exactly at its midpoint via binary search', () => {
        // 0 -> 8 over beat 0..4: midpoint beat 2 is the linear midpoint 4.
        automationStore.set({ lanes: [lane('l1', [point(0, 0), point(4, 8)], { maxValue: 8 })] });
        expect(getAutomationValueAtBeat('l1', 2)).toBeCloseTo(4, 10);
        expect(getAutomationValueAtBeat('l1', 1)).toBeCloseTo(2, 10);
        expect(getAutomationValueAtBeat('l1', 3)).toBeCloseTo(6, 10);
    });

    it('binary-searches a multi-point lane to interpolate the correct interior segment', () => {
        // Two adjacent segments with different slopes; the beat must resolve to
        // segment [10,20] (slope 1), not [0,10] (slope 2).
        // 0->20 over 0..10, then 20->30 over 10..20.
        automationStore.set({ lanes: [lane('l1', [point(0, 0), point(10, 20), point(20, 30)], { maxValue: 30 })] });
        // beat 15 → segment [10,20], fraction 0.5 → 20 + (30-20)*0.5 = 25.
        expect(getAutomationValueAtBeat('l1', 15)).toBeCloseTo(25, 10);
    });

    it('holds the first value across a step segment', () => {
        automationStore.set({ lanes: [lane('l1', [point(0, 3, 'step'), point(4, 9, 'step')], { maxValue: 9 })] });
        // A step curve holds the first value for the whole segment.
        expect(getAutomationValueAtBeat('l1', 3.9)).toBeCloseTo(3, 10);
    });

    it('quantizes a stairs segment into the default 4 steps', () => {
        // 0 -> 8 over beat 0..8, 4 steps: steps land at 0,2,4,6,8.
        automationStore.set({ lanes: [lane('l1', [point(0, 0, 'stairs'), point(8, 8, 'stairs')], { maxValue: 8 })] });
        // beat 1 → fraction 0.125 → floor(0.5)/4 = 0 → 0.
        expect(getAutomationValueAtBeat('l1', 1)).toBeCloseTo(0, 10);
        // beat 2 → fraction 0.25 → floor(1)/4 = 0.25 → 2.
        expect(getAutomationValueAtBeat('l1', 2)).toBeCloseTo(2, 10);
        // beat 7 → fraction 0.875 → floor(3.5)/4 = 0.75 → 6.
        expect(getAutomationValueAtBeat('l1', 7)).toBeCloseTo(6, 10);
    });

    it('applies exponential tension as a slow-attack curve (positive tension holds back near the start)', () => {
        // 0 -> 8 over beat 0..4, tension 1: midpoint collapses toward 0.
        automationStore.set({
            lanes: [
                lane('l1', [point(0, 0, 'exponential', { tension: 1 }), point(4, 8, 'exponential')], {
                    maxValue: 8,
                }),
            ],
        });
        // 0.5 ** (2**(1*3)=8) = 0.00390625 → 8 * 0.00390625 = 0.03125.
        expect(getAutomationValueAtBeat('l1', 2)).toBeCloseTo(0.03125, 5);
    });

    it('degrades an exponential curve to linear inside the tension deadzone', () => {
        // tension 0 is within the +/-0.01 deadzone → plain linear midpoint 4.
        automationStore.set({
            lanes: [
                lane('l1', [point(0, 0, 'exponential', { tension: 0 }), point(4, 8, 'exponential')], {
                    maxValue: 8,
                }),
            ],
        });
        expect(getAutomationValueAtBeat('l1', 2)).toBeCloseTo(4, 10);
    });

    it('eases an s-curve toward full smoothstep at tension 1', () => {
        // 0 -> 8 over beat 0..4, tension 1, beat 1 → fraction 0.25.
        automationStore.set({
            lanes: [lane('l1', [point(0, 0, 's-curve', { tension: 1 }), point(4, 8, 's-curve')], { maxValue: 8 })],
        });
        // smoothstep(0.25) = 0.15625 → 8 * 0.15625 = 1.25.
        expect(getAutomationValueAtBeat('l1', 1)).toBeCloseTo(1.25, 10);
    });

    it('passes the interior neighbors to a smooth (Catmull-Rom) segment so it keeps its curvature', () => {
        // Four points; the segment [4,8] has interior neighbors at beat 0 and 12.
        automationStore.set({
            lanes: [
                lane('l1', [point(0, -10), point(4, 2, 'smooth'), point(8, 8), point(12, 20)], {
                    minValue: -20,
                    maxValue: 30,
                }),
            ],
        });
        // beat 5 → fraction 0.25 of the [4,8] segment. Catmull-Rom with the
        // neighbors v0=-10,v1=2,v2=8,v3=20 = 3.78125 — distinct from the
        // neighbor-absent value 3.21875 and the linear 3.5, which proves the
        // binary search picked the [4,8] segment AND the neighbor plumbing is
        // wired (an off-by-one would resolve to the [0,4] segment instead).
        expect(getAutomationValueAtBeat('l1', 5)).toBeCloseTo(3.78125, 5);
    });
});

describe('getAutomationValueAtBeat — linked-lane resolution and scale', () => {
    beforeEach(() => {
        automationStore.set({ lanes: [] });
    });
    afterEach(() => {
        automationStore.set({ lanes: [] });
    });

    it('resolves a linked lane to its source and ignores the follower own points', () => {
        // The follower has local points but links to a source; the source is
        // authoritative, so the follower never samples its own localPoints.
        automationStore.set({
            lanes: [
                lane('follower', [point(0, 0.1), point(10, 0.9)], { linkedLaneId: 'source' }),
                lane('source', [point(0, 0), point(4, 8)], { maxValue: 8 }),
            ],
        });
        // The follower reports the source's linear midpoint (4), never 0.5.
        expect(getAutomationValueAtBeat('follower', 2)).toBeCloseTo(4, 10);
    });

    it('returns null (not a real 0) when a linked chain cycles', () => {
        // A → B → A: the cycle guard reports null so the scheduler leaves the
        // parameter untouched rather than driving it to zero.
        automationStore.set({
            lanes: [
                lane('A', [point(0, 0.7)], { linkedLaneId: 'B' }),
                lane('B', [point(0, 0.3)], { linkedLaneId: 'A' }),
            ],
        });
        expect(getAutomationValueAtBeat('A', 5)).toBeNull();
    });

    it('returns null when a lane links to itself', () => {
        automationStore.set({
            lanes: [lane('self', [point(0, 0.7)], { linkedLaneId: 'self' })],
        });
        expect(getAutomationValueAtBeat('self', 5)).toBeNull();
    });

    it('accumulates linkScale multiplicatively along a chain and applies it to the source value', () => {
        // follower -(scale 2)-> mid -(scale 3)-> source. Cumulative scale 6.
        automationStore.set({
            lanes: [
                lane('follower', [], { linkedLaneId: 'mid', linkScale: 2 }),
                lane('mid', [], { linkedLaneId: 'source', linkScale: 3 }),
                lane('source', [point(0, 1), point(4, 1)]),
            ],
        });
        // Source value 1, scaled by 6 → 6 at any beat.
        expect(getAutomationValueAtBeat('follower', 2)).toBeCloseTo(6, 10);
    });

    it('applies an inverted (negative) linkScale to invert the source curve', () => {
        // linkScale -1 inverts: source linear 0->1 becomes 0->-1.
        automationStore.set({
            lanes: [
                lane('inverted', [], { linkedLaneId: 'src', linkScale: -1 }),
                lane('src', [point(0, 0), point(4, 1)]),
            ],
        });
        // beat 2 → source midpoint 0.5, scaled by -1 → -0.5.
        expect(getAutomationValueAtBeat('inverted', 2)).toBeCloseTo(-0.5, 10);
    });

    it('scales the held first-point value when the beat is before all source points', () => {
        // Before all points the held value is points[0].value * scale.
        automationStore.set({
            lanes: [
                lane('follower', [], { linkedLaneId: 'src', linkScale: 2 }),
                lane('src', [point(5, 0.2), point(10, 0.5)]),
            ],
        });
        // Before beat 5 the source holds 0.2; scaled by 2 → 0.4.
        expect(getAutomationValueAtBeat('follower', 0)).toBeCloseTo(0.4, 10);
    });
});

describe('getAutomationValueAtBeat — declared-range clamp', () => {
    beforeEach(() => {
        automationStore.set({ lanes: [] });
    });
    afterEach(() => {
        automationStore.set({ lanes: [] });
    });

    it('clamps a smooth-curve overshoot to the lane declared maxValue', () => {
        // Points chosen so the Catmull-Rom curve through the [2,4] segment
        // overshoots above the lane's declared maxValue of 1. Sampling the
        // segment (fraction 0..1 in 0.0002 steps) found the peak at beat
        // ~3.173 with a raw (pre-clamp) value of ~1.0749 — an overshoot of
        // ~0.075 above maxValue. Beat 3.2 sits on that overshooting shoulder
        // with a raw value of 1.0748 (measured against the unmodified
        // evaluator), safely past maxValue.
        automationStore.set({
            lanes: [lane('l1', [point(0, 0.2), point(2, 0.95, 'smooth'), point(4, 1.0), point(6, 0.2)])],
        });
        const value = getAutomationValueAtBeat('l1', 3.2);
        expect(value).not.toBeNull();
        expect(value!).toBeLessThanOrEqual(1);
        expect(value!).toBeGreaterThanOrEqual(0);
    });

    it('does not clamp a value that is genuinely inside the declared range', () => {
        automationStore.set({ lanes: [lane('l1', [point(0, 0.2), point(4, 0.8)])] });
        expect(getAutomationValueAtBeat('l1', 2)).toBeCloseTo(0.5, 10);
    });
});
