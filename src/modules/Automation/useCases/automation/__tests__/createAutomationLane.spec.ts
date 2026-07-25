import { describe, expect, it } from 'vitest';

import { createAutomationLane } from '../createAutomationLane';

describe('createAutomationLane', () => {
    it('builds an empty lane with the given identity and range', () => {
        const lane = createAutomationLane('track-1', 'gain', 'Gain', 0, 2, 'clip-1');

        expect(lane).toMatchObject({
            trackId: 'track-1',
            clipId: 'clip-1',
            parameterId: 'gain',
            parameterName: 'Gain',
            points: [],
            objects: [],
            visible: true,
            enabled: true,
            collapsed: false,
            minValue: 0,
            maxValue: 2,
        });
        expect(lane.id).toMatch(/^auto-/);
    });

    it('defaults minValue/maxValue to 0..1 and leaves clipId undefined', () => {
        const lane = createAutomationLane('track-2', 'pan', 'Pan');

        expect(lane.minValue).toBe(0);
        expect(lane.maxValue).toBe(1);
        expect(lane.clipId).toBeUndefined();
    });

    it('generates a unique id for every lane', () => {
        const first = createAutomationLane('track-1', 'gain', 'Gain');
        const second = createAutomationLane('track-1', 'gain', 'Gain');

        expect(first.id).not.toBe(second.id);
    });
});
