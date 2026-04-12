import { describe, expect, it } from 'vitest';

import { createTake, createTakeLane } from '../TakeLane';

describe('createTake', () => {
    it('creates an unselected take with beat range', () => {
        const a = createTake('clip-1', 'T1', 0, 4);
        const b = createTake('clip-1', 'T2', 4, 8);
        expect(a.clipId).toBe('clip-1');
        expect(a.name).toBe('T1');
        expect(a.selected).toBe(false);
        expect(a.id).toMatch(/^take-\d+$/);
        expect(b.id).not.toBe(a.id);
    });
});

describe('createTakeLane', () => {
    it('creates an empty lane for a track', () => {
        const lane = createTakeLane('trk-1');
        expect(lane.trackId).toBe('trk-1');
        expect(lane.takes).toEqual([]);
        expect(lane.activeCompRegions).toEqual([]);
        expect(lane.id).toMatch(/^take-lane-\d+$/);
    });
});
