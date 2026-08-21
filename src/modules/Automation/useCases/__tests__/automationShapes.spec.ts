import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FADER_MAX_GAIN } from '#/utils/audioLevelLaw';

import { type AutomationLane } from '../../models/Automation';
import { insertAutomationShape } from '../automationShapes';

const storeCell = vi.hoisted(() => ({
    state: null as { lanes: AutomationLane[] } | null,
}));

vi.mock('../../stores/automationStore', () => ({
    automationStore: {
        get value() {
            return storeCell.state;
        },
        set(next: { lanes: AutomationLane[] }) {
            storeCell.state = next;
        },
    },
}));

function makeLane(id: string): AutomationLane {
    return {
        id,
        trackId: 'track-1',
        parameterId: 'gain',
        parameterName: 'Gain',
        points: [],
        objects: [],
        visible: true,
        enabled: true,
        collapsed: false,
        minValue: 0,
        maxValue: 10,
    };
}

describe('automationShapes', () => {
    beforeEach(() => {
        storeCell.state = { lanes: [makeLane('lane-a')] };
    });

    it('inserts scaled triangle points into the target lane', () => {
        insertAutomationShape('lane-a', 'triangle', 0, 4);

        expect(storeCell.state?.lanes[0]?.points).toEqual([
            { beat: 0, value: 0, curve: 'linear', tension: 0 },
            { beat: 2, value: 10, curve: 'linear', tension: 0 },
            { beat: 4, value: 0, curve: 'linear', tension: 0 },
        ]);
    });

    it('skips duplicate cycle boundary points', () => {
        insertAutomationShape('lane-a', 'sawtooth-up', 0, 8, 2);

        expect(storeCell.state?.lanes[0]?.points).toEqual([
            { beat: 0, value: 0, curve: 'linear', tension: 0 },
            { beat: 4, value: 0, curve: 'linear', tension: 0 },
            { beat: 8, value: 10, curve: 'linear', tension: 0 },
        ]);
    });

    it('produces an identical random shape on every insertion (deterministic)', () => {
        insertAutomationShape('lane-a', 'random', 0, 4);
        const first = storeCell.state?.lanes[0]?.points;

        // A second insertion over the same range must yield the same values —
        // a Math.random() shape would diverge, splitting CRDT collaborators on a
        // merge. The seeded RNG keeps the shape reproducible.
        storeCell.state = { lanes: [makeLane('lane-a')] };
        insertAutomationShape('lane-a', 'random', 0, 4);
        const second = storeCell.state?.lanes[0]?.points;

        expect(second).toEqual(first);
        // And the shape is real (not flat zeros): at least one point left the floor.
        expect(first?.some((point) => point.value > 0)).toBe(true);
    });

    it('inserts a square shape with step curves at the peaks', () => {
        insertAutomationShape('lane-a', 'square', 0, 4);
        expect(storeCell.state?.lanes[0]?.points).toEqual([
            { beat: 0, value: 10, curve: 'step', tension: 0 },
            { beat: 2, value: 0, curve: 'step', tension: 0 },
            { beat: 4, value: 10, curve: 'step', tension: 0 },
        ]);
    });

    it('spans a legacy gain lane over the ceiling the fader has, not the unity it stores', () => {
        // Same lane, same request, two creation dates: a gain lane written
        // before the fader gained its `+6 dB` of headroom still records
        // `maxValue: 1`, and reading that scalar made a full-depth shape a
        // different depth on an old project than on a new one.
        storeCell.state = { lanes: [{ ...makeLane('lane-legacy'), maxValue: 1 }] };
        insertAutomationShape('lane-legacy', 'square', 0, 4);

        expect(storeCell.state.lanes[0]?.points).toEqual([
            { beat: 0, value: FADER_MAX_GAIN, curve: 'step', tension: 0 },
            { beat: 2, value: 0, curve: 'step', tension: 0 },
            { beat: 4, value: FADER_MAX_GAIN, curve: 'step', tension: 0 },
        ]);
    });

    it('leaves a clip gain lane at the unity it declares', () => {
        // A clip's own gain is not a fader; the strip's headroom says nothing
        // about it, so the derivation must not reach in here.
        storeCell.state = { lanes: [{ ...makeLane('lane-clip'), maxValue: 1, clipId: 'clip-1' }] };
        insertAutomationShape('lane-clip', 'square', 0, 4);

        expect(storeCell.state.lanes[0]?.points.map((point) => point.value)).toEqual([1, 0, 1]);
    });

    it('inserts a sawtooth-down shape (high → low)', () => {
        insertAutomationShape('lane-a', 'sawtooth-down', 0, 4);
        expect(storeCell.state?.lanes[0]?.points).toEqual([
            { beat: 0, value: 10, curve: 'linear', tension: 0 },
            { beat: 4, value: 0, curve: 'linear', tension: 0 },
        ]);
    });

    it('inserts a sine shape with smooth curves and 0.5 tension', () => {
        insertAutomationShape('lane-a', 'sine', 0, 4);
        const points = storeCell.state?.lanes[0]?.points;
        expect(points).toHaveLength(5);
        // peaks at the 1/4 mark (beat 1) at max, troughs elsewhere
        expect(points?.[1]).toEqual({ beat: 1, value: 10, curve: 'smooth', tension: 0.5 });
        expect(points?.every((p) => p.curve === 'smooth')).toBe(true);
    });

    // A sine cycle spaces its points a quarter-cycle apart, so any range under
    // 0.2 beats puts adjacent points inside the freehand-jitter merge window
    // (0.05 beats) and the whole shape used to collapse onto one point. Beats
    // are compared in milli-beats because 0.12 * 0.25 is not an exact binary
    // double.
    it('lands every point of a sine shape denser than the freehand merge window', () => {
        insertAutomationShape('lane-a', 'sine', 0, 0.12);

        const points = storeCell.state?.lanes[0]?.points ?? [];
        expect(points.map((point) => Math.round(point.beat * 1000))).toEqual([0, 30, 60, 90, 120]);
        expect(points.every((point) => point.curve === 'smooth' && point.tension === 0.5)).toBe(true);
    });

    it('lands every point of a multi-cycle dense sine shape, boundaries included', () => {
        insertAutomationShape('lane-a', 'sine', 0, 0.24, 2);

        const points = storeCell.state?.lanes[0]?.points ?? [];
        expect(points.map((point) => Math.round(point.beat * 1000))).toEqual([0, 30, 60, 90, 120, 150, 180, 210, 240]);
    });

    // Random spaces its points an eighth-cycle apart: 0.3 beats gives 0.0375
    // gaps, again inside the default merge window.
    it('lands every point of a random shape denser than the freehand merge window', () => {
        insertAutomationShape('lane-a', 'random', 0, 0.3);

        expect(storeCell.state?.lanes[0]?.points).toHaveLength(9);
    });

    // The density-sized epsilon must not stop the batch from merging into a
    // pre-existing point it legitimately overwrites: a shape whose own gaps
    // are wide keeps the freehand default, and a dense shape still merges with
    // whatever sits inside its (now smaller) window.
    it('still merges a generated point into a pre-existing point within the freehand window', () => {
        storeCell.state = {
            lanes: [{ ...makeLane('lane-a'), points: [{ beat: 1.999, value: 4, curve: 'linear', tension: 0 }] }],
        };
        insertAutomationShape('lane-a', 'triangle', 0, 4);

        // The triangle's beat-2 point lands within 0.05 beats of the existing
        // 1.999 point and takes it over — the later write wins wholesale, so
        // the surviving point carries the incoming beat 2 and the lane holds
        // 3 points, not 4.
        expect(storeCell.state?.lanes[0]?.points.map((point) => point.beat)).toEqual([0, 2, 4]);
        expect(storeCell.state?.lanes[0]?.points[1]?.value).toBe(10);
    });

    // The merge test above cannot see the cap: this shape's 2-beat gaps would
    // give an uncapped epsilon of 1.0, which would swallow the pre-existing
    // 2.2 point into the generated beat 2. The 0.2 offset sits far outside the
    // freehand 0.05 window, so only the capped default leaves both standing.
    it('keeps a pre-existing point outside the freehand window even when the shape spacing is wide', () => {
        storeCell.state = {
            lanes: [{ ...makeLane('lane-a'), points: [{ beat: 2.2, value: 4, curve: 'linear', tension: 0 }] }],
        };
        insertAutomationShape('lane-a', 'triangle', 0, 4);

        expect(storeCell.state?.lanes[0]?.points.map((point) => point.beat)).toEqual([0, 2, 2.2, 4]);
    });

    it('scales shape values to the lane min/max when they differ from 0/10', () => {
        storeCell.state = { lanes: [{ ...makeLane('lane-b'), minValue: 20, maxValue: 40 }] };
        insertAutomationShape('lane-b', 'triangle', 0, 4);
        // mid point = 20 + 1*(40-20) = 40; endpoints = 20
        const points = storeCell.state?.lanes[0]?.points;
        expect(points?.map((p) => p.value)).toEqual([20, 40, 20]);
    });

    it('does nothing when the automation store is null', () => {
        storeCell.state = null;
        // must not throw and must not mutate anything
        expect(() => insertAutomationShape('lane-a', 'triangle', 0, 4)).not.toThrow();
    });

    it('does nothing when the target lane does not exist', () => {
        insertAutomationShape('missing-lane', 'triangle', 0, 4);
        // the existing lane is untouched
        expect(storeCell.state?.lanes[0]?.points).toEqual([]);
    });
});
