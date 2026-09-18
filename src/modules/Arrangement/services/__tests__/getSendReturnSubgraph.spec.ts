import { describe, expect, it } from 'vitest';

import { TrackDummy } from '../../__tests__/TrackDummy';
import { getSendReturnSubgraph } from '../getSendReturnSubgraph';

type SidechainRouteInput = {
    sourceTrackId: string;
    targetTrackId: string;
};

function createSend(busId: string): { busId: string; level: number; preFader: boolean } {
    return { busId, level: 0.5, preFader: false };
}

function createSidechainRoute(sourceTrackId: string, targetTrackId: string): SidechainRouteInput {
    return { sourceTrackId, targetTrackId };
}

describe('getSendReturnSubgraph', () => {
    it('collects the return bus the target sends into', () => {
        const tracks = [
            TrackDummy.create({ id: 'target', sends: [createSend('return-bus')] }),
            TrackDummy.create({ id: 'return-bus', kind: 'bus' }),
        ];

        const result = getSendReturnSubgraph('target', tracks, []);

        expect([...result.returnTrackIds]).toEqual(['return-bus']);
        expect(result.keyTrackIds.size).toBe(0);
    });

    it('collects returns nested behind other returns via their own sends', () => {
        const tracks = [
            TrackDummy.create({ id: 'target', sends: [createSend('reverb')] }),
            TrackDummy.create({ id: 'reverb', kind: 'bus', sends: [createSend('delay')] }),
            TrackDummy.create({ id: 'delay', kind: 'bus' }),
        ];

        const result = getSendReturnSubgraph('target', tracks, []);

        expect([...result.returnTrackIds].sort()).toEqual(['delay', 'reverb']);
    });

    it('keeps a shared return target-only: other senders into it are not collected', () => {
        const tracks = [
            TrackDummy.create({ id: 'target', sends: [createSend('shared-bus')] }),
            TrackDummy.create({ id: 'other-vocal', sends: [createSend('shared-bus')] }),
            TrackDummy.create({ id: 'shared-bus', kind: 'bus' }),
        ];

        const result = getSendReturnSubgraph('target', tracks, []);

        expect([...result.returnTrackIds]).toEqual(['shared-bus']);
        // Neither the other sender nor its own routing leaks into the subgraph.
        expect(result.keyTrackIds.has('other-vocal')).toBe(false);
        expect(result.returnTrackIds.has('other-vocal')).toBe(false);
    });

    it('never pulls a return through its own send-upstream, which belongs to other sources', () => {
        // 'other-vocal' SENDS into the return, so in the upstream walk it would
        // be collected as the return's predecessor. This walk goes the other
        // direction on purpose.
        const tracks = [
            TrackDummy.create({ id: 'target', sends: [createSend('return-bus')] }),
            TrackDummy.create({ id: 'other-vocal', sends: [createSend('return-bus')] }),
            TrackDummy.create({ id: 'return-bus', kind: 'bus' }),
        ];

        const result = getSendReturnSubgraph('target', tracks, []);

        expect(result.returnTrackIds).toEqual(new Set(['return-bus']));
    });

    it('collects the sidechain keys feeding a return device, but not keys of unrelated tracks', () => {
        const tracks = [
            TrackDummy.create({ id: 'target', sends: [createSend('pumping-return')] }),
            TrackDummy.create({ id: 'pumping-return', kind: 'bus' }),
            TrackDummy.create({ id: 'plain-track' }),
        ];
        const routes = [
            createSidechainRoute('kick-key', 'pumping-return'),
            createSidechainRoute('other-key', 'plain-track'),
        ];

        const result = getSendReturnSubgraph('target', tracks, routes);

        expect([...result.keyTrackIds]).toEqual(['kick-key']);
    });

    it('ignores a self-keyed return whose key is the target itself', () => {
        const tracks = [
            TrackDummy.create({ id: 'target', sends: [createSend('return-bus')] }),
            TrackDummy.create({ id: 'return-bus', kind: 'bus' }),
        ];
        const routes = [createSidechainRoute('target', 'return-bus')];

        const result = getSendReturnSubgraph('target', tracks, routes);

        expect([...result.returnTrackIds]).toEqual(['return-bus']);
        expect(result.keyTrackIds.size).toBe(0);
    });

    it('tolerates a send naming a bus the project does not contain', () => {
        const tracks = [TrackDummy.create({ id: 'target', sends: [createSend('ghost-bus')] })];

        const result = getSendReturnSubgraph('target', tracks, []);

        // A ghost bus is not a track, so there is nothing to render or print.
        expect(result.returnTrackIds.size).toBe(0);
        expect(result.keyTrackIds.size).toBe(0);
    });

    it('terminates on a send cycle between the target and a return', () => {
        const tracks = [
            TrackDummy.create({ id: 'target', sends: [createSend('return-bus')] }),
            TrackDummy.create({ id: 'return-bus', kind: 'bus', sends: [createSend('target')] }),
        ];

        const result = getSendReturnSubgraph('target', tracks, []);

        // The back-edge to the already-visited target is skipped, so the walk
        // stops instead of spinning.
        expect([...result.returnTrackIds]).toEqual(['return-bus']);
    });
});
