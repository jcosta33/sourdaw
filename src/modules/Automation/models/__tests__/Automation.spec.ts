import { describe, expect, it } from 'vitest';

import { createAutomationLane, createAutomationObject } from '../Automation';

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
        expect(lane.virginTerritory).toBe(true);
        expect(lane.minValue).toBe(0);
        expect(lane.maxValue).toBe(1);
        expect(lane.id).toMatch(/^auto-[0-9a-f]{8}$/);
    });
});

describe('createAutomationObject', () => {
    it('builds an object with points and optional name', () => {
        const pts = [{ beat: 0, value: 0.5, curve: 'linear' as const, tension: 0 }];
        const obj = createAutomationObject('lane-1', 0, 4, pts, 'Ramp');
        expect(obj.laneId).toBe('lane-1');
        expect(obj.startBeat).toBe(0);
        expect(obj.endBeat).toBe(4);
        expect(obj.points).toBe(pts);
        expect(obj.name).toBe('Ramp');
        expect(obj.id).toMatch(/^auto-obj-[0-9a-f]{8}$/);
    });

    it('defaults name to Untitled when omitted', () => {
        const obj = createAutomationObject('lane-1', 0, 1);
        expect(obj.name).toBe('Untitled');
        expect(obj.points).toEqual([]);
    });
});
