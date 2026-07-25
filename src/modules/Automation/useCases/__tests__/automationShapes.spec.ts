import { beforeEach, describe, expect, it, vi } from 'vitest';

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
