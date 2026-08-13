import { describe, it, expect } from 'vitest';

import { hasRoutingCycle, type RoutingCycleTrack, wouldCreateRoutingCycle } from '../routingCycle';

function track(id: string, outputId: string, sendBusIds: string[] = []): RoutingCycleTrack {
    return { id, outputId, sends: sendBusIds.map((busId) => ({ busId })) };
}

describe('wouldCreateRoutingCycle', () => {
    it('rejects a self-edge', () => {
        expect(wouldCreateRoutingCycle({ sourceId: 't1', targetId: 't1', tracks: [track('t1', 'master')] })).toBe(true);
    });

    it('rejects a two-node loop closed through outputs', () => {
        // busA → busB already; busB → busA would close it.
        const tracks = [track('busA', 'busB'), track('busB', 'master')];
        expect(wouldCreateRoutingCycle({ sourceId: 'busB', targetId: 'busA', tracks })).toBe(true);
    });

    it('rejects a three-node loop A→B→C→A', () => {
        const tracks = [track('busA', 'busB'), track('busB', 'busC'), track('busC', 'master')];
        expect(wouldCreateRoutingCycle({ sourceId: 'busC', targetId: 'busA', tracks })).toBe(true);
    });

    it('rejects a loop that only closes through a send edge', () => {
        // Outputs alone are acyclic; the send busA →(send) busB is the return path.
        const tracks = [track('busA', 'master', ['busB']), track('busB', 'master')];
        expect(wouldCreateRoutingCycle({ sourceId: 'busB', targetId: 'busA', tracks })).toBe(true);
    });

    it('rejects a loop that only closes through a sidechain edge', () => {
        const tracks = [track('busA', 'master'), track('busB', 'master')];
        const sidechainRoutes = [{ sourceTrackId: 'busA', targetTrackId: 'busB' }];
        expect(wouldCreateRoutingCycle({ sourceId: 'busB', targetId: 'busA', tracks, sidechainRoutes })).toBe(true);
    });

    it('accepts a diamond, which converges without looping', () => {
        // busA feeds busB and busC; both feed master. Adding busB → busC keeps it a DAG.
        const tracks = [track('busA', 'busB', ['busC']), track('busB', 'master'), track('busC', 'master')];
        expect(wouldCreateRoutingCycle({ sourceId: 'busB', targetId: 'busC', tracks })).toBe(false);
    });

    it('accepts an edge onto a terminal endpoint that owns no track', () => {
        const tracks = [track('t1', 'master')];
        expect(wouldCreateRoutingCycle({ sourceId: 't1', targetId: 'hw_out', tracks })).toBe(false);
    });

    it('terminates and still answers on a graph that is already cyclic', () => {
        // Stored projects can already carry a loop: nothing guarded these writes
        // before. The walk must not hang on the pre-existing busB ⇄ busC loop.
        const tracks = [track('busA', 'master'), track('busB', 'busC'), track('busC', 'busB')];
        expect(wouldCreateRoutingCycle({ sourceId: 'busA', targetId: 'busB', tracks })).toBe(false);
        expect(wouldCreateRoutingCycle({ sourceId: 'busB', targetId: 'busC', tracks })).toBe(true);
    });

    it('follows a chain of sends across several hops', () => {
        const tracks = [
            track('t1', 'master'),
            track('busA', 'master', ['busB']),
            track('busB', 'master', ['busC']),
            track('busC', 'master', ['t1']),
        ];
        expect(wouldCreateRoutingCycle({ sourceId: 't1', targetId: 'busA', tracks })).toBe(true);
    });
});

describe('hasRoutingCycle', () => {
    it('detects a cycle already present across output, send, and sidechain edges', () => {
        const tracks = [
            { id: 'audio', outputId: 'bus-a' },
            { id: 'bus-a', sends: [{ busId: 'bus-b' }] },
            { id: 'bus-b', outputId: 'master' },
        ];

        expect(
            hasRoutingCycle({
                tracks,
                sidechainRoutes: [{ sourceTrackId: 'bus-b', targetTrackId: 'audio' }],
            })
        ).toBe(true);
    });

    it('accepts an acyclic routing graph', () => {
        const tracks = [
            { id: 'audio', outputId: 'bus-a' },
            { id: 'bus-a', sends: [{ busId: 'bus-b' }] },
            { id: 'bus-b', outputId: 'master' },
        ];

        expect(hasRoutingCycle({ tracks })).toBe(false);
    });
});
