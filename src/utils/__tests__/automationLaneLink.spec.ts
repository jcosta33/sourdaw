import { describe, it, expect } from 'vitest';

import { resolveLinkedLane, type LinkableLane } from '../automationLaneLink';

function makeLookup(lanes: LinkableLane[]): (id: string) => LinkableLane | undefined {
    const byId = new Map(lanes.map((lane) => [lane.id, lane]));
    return (id) => byId.get(id);
}

describe('resolveLinkedLane', () => {
    it('resolves an unlinked lane to itself with scale 1', () => {
        const lookup = makeLookup([{ id: 'solo' }]);

        expect(resolveLinkedLane('solo', lookup)).toEqual({ sourceLaneId: 'solo', scale: 1 });
    });

    it('follows a single link to its source and carries linkScale', () => {
        const lookup = makeLookup([{ id: 'follower', linkedLaneId: 'source', linkScale: -1 }, { id: 'source' }]);

        expect(resolveLinkedLane('follower', lookup)).toEqual({ sourceLaneId: 'source', scale: -1 });
    });

    it('multiplies linkScale along a chain to the authoritative source', () => {
        const lookup = makeLookup([
            { id: 'a', linkedLaneId: 'b', linkScale: -1 },
            { id: 'b', linkedLaneId: 'c', linkScale: 0.5 },
            { id: 'c' },
        ]);

        expect(resolveLinkedLane('a', lookup)).toEqual({ sourceLaneId: 'c', scale: -0.5 });
    });

    it('defaults a missing linkScale hop to 1', () => {
        const lookup = makeLookup([{ id: 'follower', linkedLaneId: 'source' }, { id: 'source' }]);

        expect(resolveLinkedLane('follower', lookup)).toEqual({ sourceLaneId: 'source', scale: 1 });
    });

    it('returns null for a two-lane cycle', () => {
        const lookup = makeLookup([
            { id: 'a', linkedLaneId: 'b' },
            { id: 'b', linkedLaneId: 'a' },
        ]);

        expect(resolveLinkedLane('a', lookup)).toBeNull();
    });

    it('returns null for a self link', () => {
        const lookup = makeLookup([{ id: 'a', linkedLaneId: 'a' }]);

        expect(resolveLinkedLane('a', lookup)).toBeNull();
    });

    it('returns null when a lane in the chain is missing', () => {
        const lookup = makeLookup([{ id: 'follower', linkedLaneId: 'gone' }]);

        expect(resolveLinkedLane('follower', lookup)).toBeNull();
    });

    it('reuses a supplied visited set, clearing it before each resolution', () => {
        const lookup = makeLookup([{ id: 'follower', linkedLaneId: 'source', linkScale: 2 }, { id: 'source' }]);
        const visited = new Set<string>(['stale-entry']);

        const result = resolveLinkedLane('follower', lookup, visited);

        expect(result).toEqual({ sourceLaneId: 'source', scale: 2 });
        expect(visited.has('stale-entry')).toBe(false);
        expect(visited.has('follower')).toBe(true);
    });
});
