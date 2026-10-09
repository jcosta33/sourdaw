import { describe, expect, it } from 'vitest';

import { createTake, createTakeLane, isValidTakeSourceDepthFields } from '../TakeLane';

// F9: the full UUID, not the truncated 8-hex-char prefix
// `crypto.randomUUID().slice(0, 8)` these ids used to carry — truncating
// invited birthday collisions, per the lesson already documented for clip ids
// in `clipIdCounter.ts`.
const UUID_BODY = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

describe('captured take source fields', () => {
    const legacy = { sourceOffsetSeconds: null, sourceOffsetBeats: null };
    const placed = { sourceOffsetSeconds: 1, sourceOffsetBeats: 2, passAnchorSeconds: -2, passDepthSeconds: 0 };
    it.each([
        { name: 'legacy absence', source: legacy, valid: true },
        { name: 'canonical zero', source: { ...legacy, sourceOffsetSeconds: 0 }, valid: true },
        { name: 'signed anchor and zero depth', source: placed, valid: true },
        { name: 'lone anchor', source: { ...legacy, passAnchorSeconds: 0 }, valid: false },
        { name: 'lone depth', source: { ...legacy, passDepthSeconds: 0 }, valid: false },
        { name: 'pair without beat depth', source: { ...placed, sourceOffsetBeats: null }, valid: false },
        { name: 'negative legacy seconds', source: { ...legacy, sourceOffsetSeconds: -1 }, valid: false },
        { name: 'negative legacy beats', source: { ...legacy, sourceOffsetBeats: -1 }, valid: false },
        {
            name: 'nonfinite legacy seconds',
            source: { ...legacy, sourceOffsetSeconds: Number.POSITIVE_INFINITY },
            valid: false,
        },
        { name: 'nonfinite legacy beats', source: { ...legacy, sourceOffsetBeats: Number.NaN }, valid: false },
        { name: 'negative placed depth', source: { ...placed, passDepthSeconds: -1 }, valid: false },
        { name: 'nonfinite anchor', source: { ...placed, passAnchorSeconds: Number.NEGATIVE_INFINITY }, valid: false },
        { name: 'nonfinite placed depth', source: { ...placed, passDepthSeconds: Number.NaN }, valid: false },
    ])('validates captured source depths for $name', ({ source, valid }) => {
        expect(isValidTakeSourceDepthFields(source)).toBe(valid);
    });
});

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
