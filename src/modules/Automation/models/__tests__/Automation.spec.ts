import { describe, expect, it } from 'vitest';

import { createAutomationLane } from '../Automation';

describe('createAutomationLane', () => {
    it('builds a lane with defaults and optional clip id', () => {
        const lane = createAutomationLane('track-1', 'gain', 'Gain', 0, 1, 'clip-a');
        expect(lane.trackId).toBe('track-1');
        expect(lane.clipId).toBe('clip-a');
        expect(lane.parameterId).toBe('gain');
        expect(lane.parameterName).toBe('Gain');
        expect(lane.points).toEqual([]);
        expect(lane.objects).toEqual([]);
        expect(lane.visible).toBe(true);
        expect(lane.enabled).toBe(true);
        // virginTerritory was removed from the lane model; a new lane must not carry it.
        expect(lane).not.toHaveProperty('virginTerritory');
        expect(lane.minValue).toBe(0);
        expect(lane.maxValue).toBe(1);
        // Full UUID (8-4-4-4-12 hex), not a 32-bit truncation — see createAutomationLane.
        expect(lane.id).toMatch(/^auto-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });
});
