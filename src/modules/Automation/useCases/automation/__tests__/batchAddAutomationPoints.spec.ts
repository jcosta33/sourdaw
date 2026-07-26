import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type AutomationLane, type AutomationPoint } from '../../../models/Automation';
import { batchAddAutomationPoints } from '../batchAddAutomationPoints';

const storeCell = vi.hoisted(() => ({
    state: null as { lanes: AutomationLane[] } | null,
}));

vi.mock('../../../stores/automationStore', () => ({
    automationStore: {
        get value() {
            return storeCell.state;
        },
        set(next: { lanes: AutomationLane[] }) {
            storeCell.state = next;
        },
    },
}));

function makeLane(id: string, points: AutomationPoint[]): AutomationLane {
    return {
        id,
        trackId: 't1',
        parameterId: 'gain',
        parameterName: 'Gain',
        points,
        objects: [],
        visible: true,
        enabled: true,
        collapsed: false,
        minValue: 0,
        maxValue: 1,
    };
}

describe('batchAddAutomationPoints', () => {
    beforeEach(() => {
        storeCell.state = {
            lanes: [
                makeLane('lane-a', [{ beat: 1, value: 0.5, curve: 'linear', tension: 0 }]),
                makeLane('lane-b', [{ beat: 10, value: 1, curve: 'linear', tension: 0 }]),
            ],
        };
    });

    it('does nothing when automation store has no snapshot', () => {
        storeCell.state = null;

        batchAddAutomationPoints('lane-a', [{ beat: 2, value: 0.25, curve: 'linear', tension: 0 }]);

        expect(storeCell.state).toBeNull();
    });

    it('merges new points into the target lane and leaves other lanes unchanged', () => {
        batchAddAutomationPoints('lane-a', [
            { beat: 4, value: 0.25, curve: 'linear', tension: 0 },
            { beat: 2, value: 0.75, curve: 'linear', tension: 0 },
        ]);

        const laneA = storeCell.state!.lanes.find((length) => length.id === 'lane-a');
        const laneB = storeCell.state!.lanes.find((length) => length.id === 'lane-b');

        expect(laneA?.points.map((param) => param.beat)).toEqual([1, 2, 4]);
        expect(laneB?.points).toEqual([{ beat: 10, value: 1, curve: 'linear', tension: 0 }]);
    });

    it('replaces an existing point when the new point is within 0.05 beats', () => {
        batchAddAutomationPoints('lane-a', [{ beat: 1.02, value: 0.9, curve: 'linear', tension: 0 }]);

        const laneA = storeCell.state!.lanes.find((length) => length.id === 'lane-a');
        expect(laneA?.points).toHaveLength(1);
        expect(laneA?.points[0]).toMatchObject({ beat: 1.02, value: 0.9 });
    });
});
