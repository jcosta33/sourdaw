import { beforeEach, describe, expect, it } from 'vitest';

import { automationStore } from '../../../stores/automationStore';
import { reverseAutomation } from '../reverseAutomation';

describe('reverseAutomation', () => {
    beforeEach(() => {
        automationStore.set({ lanes: [] });
    });

    it('reverses point content without moving the lane interval', () => {
        automationStore.set({
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 'track-1',
                    parameterId: 'gain',
                    parameterName: 'Gain',
                    points: [
                        { id: 'point-a', beat: 4, value: 0.2, curve: 'linear', tension: 0 },
                        { id: 'point-b', beat: 8, value: 0.8, curve: 'linear', tension: 0 },
                    ],
                    objects: [],
                    visible: true,
                    enabled: true,
                    collapsed: false,
                    minValue: 0,
                    maxValue: 1,
                },
            ],
        });

        reverseAutomation('lane-1');

        expect(automationStore.value?.lanes[0]?.points).toEqual([
            { id: 'point-b', beat: 4, value: 0.8, curve: 'linear', tension: 0 },
            { id: 'point-a', beat: 8, value: 0.2, curve: 'linear', tension: 0 },
        ]);
    });
});
