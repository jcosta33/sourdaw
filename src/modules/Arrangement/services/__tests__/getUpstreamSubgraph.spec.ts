import { afterEach, describe, expect, it, vi } from 'vitest';

import { logger } from '#/infra/logger/appLogger';

import { TrackDummy } from '../../__tests__/TrackDummy';
import { getUpstreamSubgraph } from '../getUpstreamSubgraph';

describe('getUpstreamSubgraph', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });
    it('should include tracks that output directly to the target track', () => {
        const tracks = [
            TrackDummy.create({ id: 'target' }),
            TrackDummy.create({ id: 'source', outputId: 'target' }),
            TrackDummy.create({ id: 'unrelated', outputId: 'master' }),
        ];

        const result = getUpstreamSubgraph('target', tracks, []);

        expect([...result].sort()).toEqual(['source']);
    });

    it('should include tracks that send to the target bus', () => {
        const tracks = [
            TrackDummy.create({ id: 'bus', kind: 'bus' }),
            TrackDummy.create({
                id: 'source',
                sends: [{ busId: 'bus', level: 0.5, preFader: false }],
            }),
            TrackDummy.create({
                id: 'unrelated',
                sends: [{ busId: 'elsewhere', level: 0.5, preFader: false }],
            }),
        ];

        const result = getUpstreamSubgraph('bus', tracks, []);

        expect([...result].sort()).toEqual(['source']);
    });

    it('should include source tracks that sidechain into the target track', () => {
        const tracks = [TrackDummy.create({ id: 'vocal' }), TrackDummy.create({ id: 'kick' })];
        const sidechainRoutes = [
            {
                sourceTrackId: 'kick',
                targetTrackId: 'vocal',
                gain: 0.7,
            },
        ];

        const result = getUpstreamSubgraph('vocal', tracks, sidechainRoutes);

        expect([...result].sort()).toEqual(['kick']);
    });

    it('should include transitive upstream dependencies across routing, sends, and sidechains', () => {
        const tracks = [
            TrackDummy.create({ id: 'target' }),
            TrackDummy.create({ id: 'bus', kind: 'bus', outputId: 'target' }),
            TrackDummy.create({ id: 'source', outputId: 'bus' }),
            TrackDummy.create({
                id: 'send-source',
                sends: [{ busId: 'source', level: 0.25, preFader: true }],
            }),
            TrackDummy.create({ id: 'sidechain-source' }),
        ];
        const sidechainRoutes = [
            {
                sourceTrackId: 'sidechain-source',
                targetTrackId: 'send-source',
            },
        ];

        const result = getUpstreamSubgraph('target', tracks, sidechainRoutes);

        expect([...result].sort()).toEqual(['bus', 'send-source', 'sidechain-source', 'source']);
    });

    it('should terminate cycles and remove the target id from the result', () => {
        const tracks = [
            TrackDummy.create({ id: 'target', outputId: 'upstream-a' }),
            TrackDummy.create({ id: 'upstream-a', outputId: 'upstream-b' }),
            TrackDummy.create({ id: 'upstream-b', outputId: 'target' }),
        ];

        const result = getUpstreamSubgraph('target', tracks, []);

        expect([...result].sort()).toEqual(['upstream-a', 'upstream-b']);
    });

    it('should warn when a routing cycle is detected upstream of the target', () => {
        const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
        const tracks = [
            TrackDummy.create({ id: 'target', outputId: 'upstream-a' }),
            TrackDummy.create({ id: 'upstream-a', outputId: 'upstream-b' }),
            TrackDummy.create({ id: 'upstream-b', outputId: 'target' }),
        ];

        getUpstreamSubgraph('target', tracks, []);

        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(String(warnSpy.mock.calls[0]![0])).toContain('cycle');
    });

    it('should not warn for an acyclic diamond graph', () => {
        const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
        const tracks = [
            TrackDummy.create({ id: 'target' }),
            TrackDummy.create({ id: 'left', outputId: 'target' }),
            TrackDummy.create({ id: 'right', outputId: 'target' }),
            TrackDummy.create({ id: 'shared', outputId: 'left' }),
            TrackDummy.create({ id: 'shared-2', outputId: 'right' }),
        ];
        // 'shared' also feeds 'right' via a send — a diamond join, not a cycle.
        tracks[3]!.sends = [{ busId: 'right', level: 0.5, preFader: false }];

        getUpstreamSubgraph('target', tracks, []);

        expect(warnSpy).not.toHaveBeenCalled();
    });
});
