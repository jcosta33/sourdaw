import { beforeEach, describe, expect, it } from 'vitest';

import { automationStore } from '../../../stores/automationStore';
import { addAutomationLane } from '../addAutomationLane';

describe('addAutomationLane', () => {
    beforeEach(() => {
        automationStore.set({ lanes: [] });
    });

    it.each([
        ['gain', 0, 1],
        ['pan', -1, 1],
    ])('creates a %s lane with its canonical normalized bounds', (parameterId, expectedMin, expectedMax) => {
        addAutomationLane('track-1', parameterId, parameterId === 'gain' ? 'Gain' : 'Pan');

        expect(automationStore.value?.lanes).toEqual([
            expect.objectContaining({
                trackId: 'track-1',
                parameterId,
                minValue: expectedMin,
                maxValue: expectedMax,
            }),
        ]);
    });

    it('does not recreate an existing target under a different replay id', () => {
        addAutomationLane('track-1', 'gain', 'Gain', 'lane-original');
        addAutomationLane('track-1', 'gain', 'Gain', 'lane-replay');

        expect(automationStore.value?.lanes.map((lane) => lane.id)).toEqual(['lane-original']);
    });
});
