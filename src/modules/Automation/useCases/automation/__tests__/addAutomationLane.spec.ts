import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAutomationLane } from '../../../models/Automation';
import { automationStore } from '../../../stores/automationStore';
import { addAutomationLane } from '../addAutomationLane';
import { setAutomationParameterRangeResolver } from '../automationParameterRangeDependencies';

describe('addAutomationLane', () => {
    beforeEach(() => {
        setAutomationParameterRangeResolver(null);
        automationStore.set({ lanes: [] });
    });

    afterEach(() => {
        setAutomationParameterRangeResolver(null);
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

    it('uses the owning device descriptor range for a device parameter lane', () => {
        const resolveRange = vi.fn(() => ({ minValue: 20, maxValue: 20_000 }));
        setAutomationParameterRangeResolver(resolveRange);

        addAutomationLane('track-1', 'device-1:high_cut', 'High Cut');

        expect(resolveRange).toHaveBeenCalledWith({
            trackId: 'track-1',
            parameterTargetId: 'device-1:high_cut',
        });
        expect(automationStore.value?.lanes[0]).toMatchObject({ minValue: 20, maxValue: 20_000 });
    });

    it('does not recreate an existing target under a different replay id', () => {
        addAutomationLane('track-1', 'gain', 'Gain', 'lane-original');
        addAutomationLane('track-1', 'gain', 'Gain', 'lane-replay');

        expect(automationStore.value?.lanes.map((lane) => lane.id)).toEqual(['lane-original']);
    });

    it('does not rescale an existing lane when its descriptor range is now available', () => {
        const existing = {
            ...createAutomationLane('track-1', 'device-1:high_cut', 'High Cut', 0, 1),
            id: 'lane-existing',
        };
        automationStore.set({ lanes: [existing] });
        const resolveRange = vi.fn(() => ({ minValue: 20, maxValue: 20_000 }));
        setAutomationParameterRangeResolver(resolveRange);

        addAutomationLane('track-1', 'device-1:high_cut', 'High Cut', 'lane-replay');

        expect(automationStore.value?.lanes).toEqual([existing]);
        expect(resolveRange).not.toHaveBeenCalled();
    });
});
