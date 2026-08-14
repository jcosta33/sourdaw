import { describe, expect, it } from 'vitest';

import { createTake, createTakeLane } from '../TakeLane';

// F9: the full UUID, not the truncated 8-hex-char prefix
// `crypto.randomUUID().slice(0, 8)` these ids used to carry — truncating
// invited birthday collisions, per the lesson already documented for clip ids
// in `clipIdCounter.ts`.
const UUID_BODY = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

describe('createTake', () => {
    it('creates an unselected take with beat range', () => {
        const alpha = createTake('clip-1', 'T1', 0, 4);
        const buffer = createTake('clip-1', 'T2', 4, 8);
        expect(alpha.clipId).toBe('clip-1');
        expect(alpha.name).toBe('T1');
        expect(alpha.selected).toBe(false);
        expect(alpha.id).toMatch(new RegExp(`^take-${UUID_BODY}$`, 'i'));
        expect(buffer.id).not.toBe(alpha.id);
    });
});

describe('createTakeLane', () => {
    it('creates an empty lane for a track', () => {
        const lane = createTakeLane('trk-1');
        expect(lane.trackId).toBe('trk-1');
        expect(lane.takes).toEqual([]);
        expect(lane.activeCompRegions).toEqual([]);
        expect(lane.id).toMatch(new RegExp(`^take-lane-${UUID_BODY}$`, 'i'));
    });
});
