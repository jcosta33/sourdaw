import { describe, it, expect, beforeEach } from 'vitest';

import { groupCompingStore, type CompGroupEntry, type GroupCompRegion } from '../../../../stores/groupComping';
import { swipeGroupComp } from '../swipeGroupComp';

function makeRegion(id: string, startBeat: number, endBeat: number): GroupCompRegion {
    return { id, startBeat, endBeat, takeSetId: 'ts-old', crossfadeBeats: 0.125 };
}

function makeGroup(overrides?: Partial<CompGroupEntry>): CompGroupEntry {
    return {
        id: 'g1',
        name: 'Group 1',
        trackIds: ['t1', 't2'],
        takeSets: [],
        activeTakeSetId: null,
        compRegions: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        ...overrides,
    };
}

function groupRegions(groupId: string): GroupCompRegion[] {
    const group = groupCompingStore.value?.groups.find((entry) => entry.id === groupId);
    if (!group) {
        throw new Error(`expected group ${groupId} in store`);
    }
    return group.compRegions;
}

describe('swipeGroupComp', () => {
    beforeEach(() => {
        groupCompingStore.set({ groups: [makeGroup()], activeGroupId: 'g1', defaultCrossfade: 0.25 });
    });

    it('adds a comp region with the store default crossfade', () => {
        swipeGroupComp('g1', 'ts-new', 2, 4);

        const regions = groupRegions('g1');
        expect(regions).toHaveLength(1);
        expect(regions[0]).toMatchObject({ startBeat: 2, endBeat: 4, takeSetId: 'ts-new', crossfadeBeats: 0.25 });
        expect(regions[0]?.id).toMatch(/^gr-/);
    });

    it('replaces overlapping regions and keeps the list sorted by start beat', () => {
        groupCompingStore.set({
            groups: [
                makeGroup({
                    compRegions: [
                        makeRegion('r-after', 4, 6),
                        makeRegion('r-before', 0, 2),
                        makeRegion('r-overlap', 3, 5),
                    ],
                }),
            ],
            activeGroupId: 'g1',
            defaultCrossfade: 0.25,
        });

        swipeGroupComp('g1', 'ts-new', 2, 4);

        const regions = groupRegions('g1');
        expect(regions.map((region) => region.startBeat)).toEqual([0, 2, 4]);
        expect(regions.map((region) => region.id)).toEqual(['r-before', expect.stringMatching(/^gr-/), 'r-after']);
        expect(regions[1]).toMatchObject({ endBeat: 4, takeSetId: 'ts-new' });
    });

    it('does not touch other groups', () => {
        const untouched = makeGroup({ id: 'g2', compRegions: [makeRegion('r2', 0, 8)] });
        groupCompingStore.set({
            groups: [makeGroup(), untouched],
            activeGroupId: 'g1',
            defaultCrossfade: 0.25,
        });

        swipeGroupComp('g1', 'ts-new', 0, 4);

        expect(groupRegions('g2')).toEqual([makeRegion('r2', 0, 8)]);
    });

    it('adds nothing for an unknown group id', () => {
        swipeGroupComp('missing', 'ts-new', 0, 4);
        expect(groupRegions('g1')).toEqual([]);
    });

    it('is a no-op when the group-comping store holds no state', () => {
        groupCompingStore.clear();

        swipeGroupComp('g1', 'ts-new', 0, 4);

        expect(groupCompingStore.value).toBeNull();
    });
});
