import { describe, expect, it } from 'vitest';

import { createTake, createTakeLane } from '../../models/TakeLane';
import { deriveTakeRetirement } from '../deriveTakeRetirement';

describe('deriveTakeRetirement', () => {
    it('returns null for an absent owner, no targets or entirely preserved takes', () => {
        const take = createTake('clip', 'Preserved take', 0, 4);
        const lane = { ...createTakeLane('track'), takes: [take] };
        expect(deriveTakeRetirement({ lanes: null, clipIds: ['clip'] })).toBeNull();
        expect(deriveTakeRetirement({ lanes: [lane], clipIds: [] })).toBeNull();
        expect(deriveTakeRetirement({ lanes: [lane], clipIds: ['unrelated'] })).toBeNull();
        expect(
            deriveTakeRetirement({ lanes: [lane], clipIds: ['clip'], preservedTakeIds: new Set([take.id]) })
        ).toBeNull();
        expect(lane.takes).toEqual([take]);
        expect(take).not.toHaveProperty('sourceOffsetSeconds');
    });

    it('keeps specified empty hosts and regions this retirement did not touch', () => {
        const take = createTake('clip', 'Retired take', 0, 4);
        const host = {
            ...createTakeLane('track'),
            takes: [take],
            activeCompRegions: [
                { startBeat: 0, endBeat: 2, takeId: take.id },
                { startBeat: 2, endBeat: 4, takeId: 'already-dangling' },
            ],
        };
        const unrelated = createTakeLane('unrelated-track');
        const original = structuredClone(host);
        const plan = deriveTakeRetirement({
            lanes: [unrelated, host],
            clipIds: ['clip'],
            preservedLaneIds: new Set([host.id]),
        });
        expect(plan?.lanes).toEqual([
            unrelated,
            { ...host, takes: [], activeCompRegions: [{ startBeat: 2, endBeat: 4, takeId: 'already-dangling' }] },
        ]);
        expect(plan?.lanes[0]).toBe(unrelated);
        expect(plan?.retiredLanes).toEqual([{ lane: original, laneIndex: 1, retiredTakeIds: [take.id] }]);
        host.takes[0]!.endBeat = 99;
        expect(plan?.retiredLanes[0]?.lane).toEqual(original);
    });

    it('retires only unpreserved identities while keeping the surviving source fields exact', () => {
        const removed = createTake('clip', 'Retired', 0, 4);
        const kept = { ...createTake('clip', 'Preserved', 0, 4, 0), sourceOffsetSeconds: 0 };
        const lane = {
            ...createTakeLane('track'),
            takes: [removed, kept],
            activeCompRegions: [
                { startBeat: 0, endBeat: 2, takeId: removed.id },
                { startBeat: 2, endBeat: 4, takeId: kept.id },
            ],
        };
        const plan = deriveTakeRetirement({
            lanes: [lane],
            clipIds: ['clip'],
            preservedTakeIds: new Set([kept.id]),
        });
        expect(plan?.lanes[0]?.takes).toEqual([kept]);
        expect(plan?.lanes[0]?.takes[0]).toBe(kept);
        expect(plan?.lanes[0]?.activeCompRegions).toEqual([{ startBeat: 2, endBeat: 4, takeId: kept.id }]);
        expect(plan?.retiredLanes[0]?.retiredTakeIds).toEqual([removed.id]);
        expect(lane.takes).toEqual([removed, kept]);
    });
});
