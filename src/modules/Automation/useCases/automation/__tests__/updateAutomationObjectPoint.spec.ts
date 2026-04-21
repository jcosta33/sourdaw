import { describe, it, expect, beforeEach } from 'vitest';

import { automationStore } from '../../../stores/automationStore';
import { updateAutomationObjectPoint } from '../updateAutomationObjectPoint';

describe('updateAutomationObjectPoint', () => {
    beforeEach(() => {
        automationStore.set({
            lanes: [
                {
                    id: 'l1',
                    trackId: 't1',
                    parameterId: 'p1',
                    parameterName: 'P1',
                    points: [],
                    objects: [
                        {
                            id: 'o1',
                            poolId: 'pool1',
                            laneId: 'l1',
                            startBeat: 0,
                            endBeat: 4,
                            points: [{ beat: 1, value: 0.5, curve: 'linear', tension: 0 }],
                            name: 'Obj 1',
                        },
                        {
                            id: 'o2',
                            poolId: 'pool1',
                            laneId: 'l1',
                            startBeat: 8,
                            endBeat: 12,
                            points: [{ beat: 1, value: 0.5, curve: 'linear', tension: 0 }],
                            name: 'Obj 2',
                        },
                    ],
                    visible: true,
                    enabled: true,
                    collapsed: false,
                    virginTerritory: false,
                    minValue: 0,
                    maxValue: 1,
                },
            ],
        });
    });

    it('should propagate point updates to linked objects without overrides', () => {
        updateAutomationObjectPoint('l1', 'o1', 1, 0.8);
        const lane = automationStore.value?.lanes[0];
        expect(lane?.objects.find((output) => output.id === 'o1')?.points[0]?.value).toBe(0.8);
        expect(lane?.objects.find((output) => output.id === 'o2')?.points[0]?.value).toBe(0.8);
    });

    it('should not propagate to objects with overrides', () => {
        const state = automationStore.value!;
        state.lanes[0]!.objects[1]!.overrides = { points: true };
        automationStore.set(state);

        updateAutomationObjectPoint('l1', 'o1', 1, 0.8);
        const lane = automationStore.value?.lanes[0];
        expect(lane?.objects.find((output) => output.id === 'o1')?.points[0]?.value).toBe(0.8);
        expect(lane?.objects.find((output) => output.id === 'o2')?.points[0]?.value).toBe(0.5);
    });
});
