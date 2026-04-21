import { describe, expect, it } from 'vitest';

import { createTake, createTakeLane } from '../TakeLane';

describe('createTake', () => {
    it('creates an unselected take with beat range', () => {
        const alpha = createTake('clip-1', 'T1', 0, 4);
        const buffer = createTake('clip-1', 'T2', 4, 8);
        expect(alpha.clipId).toBe('clip-1');
        expect(alpha.name).toBe('T1');
        expect(alpha.selected).toBe(false);
        expect(alpha.id).toMatch(/^take-[a-f0-9]{8}$/i);
        expect(buffer.id).not.toBe(alpha.id);
    });
});

describe('createTakeLane', () => {
    it('creates an empty lane for a track', () => {
        const lane = createTakeLane('trk-1');
        expect(lane.trackId).toBe('trk-1');
        expect(lane.takes).toEqual([]);
        expect(lane.activeCompRegions).toEqual([]);
        expect(lane.id).toMatch(/^take-lane-[a-f0-9]{8}$/i);
    });
});
