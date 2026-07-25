import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type AutomationLane, type AutomationPoint } from '../../../models/Automation';
import { replaceAutomationLanePoints } from '../replaceAutomationLanePoints';

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
        trackId: 'track-1',
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

describe('replaceAutomationLanePoints', () => {
    beforeEach(() => {
        storeCell.state = {
            lanes: [
                makeLane('lane-a', [{ beat: 1, value: 0.5, curve: 'linear', tension: 0 }]),
                makeLane('lane-b', [{ beat: 2, value: 0.75, curve: 'linear', tension: 0 }]),
            ],
        };
    });

    it('replaces only the target lane points', () => {
        const points: AutomationPoint[] = [{ beat: 4, value: 0.25, curve: 'linear', tension: 0 }];

        replaceAutomationLanePoints({ laneId: 'lane-a', points });

        expect(storeCell.state?.lanes[0]?.points).toEqual(points);
        expect(storeCell.state?.lanes[1]?.points).toEqual([{ beat: 2, value: 0.75, curve: 'linear', tension: 0 }]);
    });

    it('clones incoming points before storing them', () => {
        const points: AutomationPoint[] = [{ beat: 4, value: 0.25, curve: 'linear', tension: 0 }];

        replaceAutomationLanePoints({ laneId: 'lane-a', points });
        points[0] = { beat: 9, value: 1, curve: 'linear', tension: 0 };

        expect(storeCell.state?.lanes[0]?.points).toEqual([{ beat: 4, value: 0.25, curve: 'linear', tension: 0 }]);
    });

    it('does nothing when automation store has no snapshot', () => {
        storeCell.state = null;

        replaceAutomationLanePoints({
            laneId: 'lane-a',
            points: [{ beat: 4, value: 0.25, curve: 'linear', tension: 0 }],
        });

        expect(storeCell.state).toBeNull();
    });
});
