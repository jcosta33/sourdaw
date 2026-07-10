import { describe, it, expect, beforeEach } from 'vitest';

import { createAutomationLane } from '../../../models/Automation';
import { automationStore } from '../../../stores/automationStore';
import { clearPointsInRange } from '../clearPointsInRange';

describe('clearPointsInRange', () => {
    beforeEach(() => {
        automationStore.set({ lanes: [] });
    });

    it('should do nothing when store is null', () => {
        automationStore.set(null);
        clearPointsInRange('lane-1', 0, 4);
        expect(automationStore.value).toBeNull();
    });

    it('should remove points whose beat falls inside the inclusive range', () => {
        const lane = createAutomationLane('t1', 'gain', 'Gain');
        lane.points = [
            { beat: 0, value: 0, curve: 'linear', tension: 0 },
            { beat: 1, value: 0.25, curve: 'linear', tension: 0 },
            { beat: 2, value: 0.5, curve: 'linear', tension: 0 },
            { beat: 4, value: 0.75, curve: 'linear', tension: 0 },
            { beat: 8, value: 1, curve: 'linear', tension: 0 },
        ];
        automationStore.set({ lanes: [lane] });

        clearPointsInRange(lane.id, 1, 4);

        const updated = automationStore.value?.lanes[0];
        expect(updated?.points.map((param) => param.beat)).toEqual([0, 8]);
    });

    it('should leave all lanes unchanged when the lane id is missing', () => {
        const lane = createAutomationLane('t1', 'gain', 'Gain');
        lane.points = [{ beat: 2, value: 0.5, curve: 'linear', tension: 0 }];
        automationStore.set({ lanes: [lane] });

        clearPointsInRange('missing-lane', 0, 4);

        expect(automationStore.value?.lanes[0]?.points).toEqual([{ beat: 2, value: 0.5, curve: 'linear', tension: 0 }]);
    });
});
