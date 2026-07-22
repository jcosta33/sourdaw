import { describe, expect, it } from 'vitest';

import { TrackDummy } from '../../__tests__/TrackDummy';
import { applySoloLogic } from '../applySoloLogic';

describe('applySoloLogic', () => {
    it('returns individual mute actions when no tracks are soloed', () => {
        const tracks = [
            TrackDummy.create({ id: 't1', muted: false, soloed: false }),
            TrackDummy.create({ id: 't2', muted: true, soloed: false }),
        ];

        const result = applySoloLogic({
            tracks,
            soloMode: 'sip',
            savedGains: new Map(),
            liveStripTrackIds: new Set(['t1', 't2']),
        });

        expect(result.actions).toEqual([
            { type: 'setMute', trackId: 't1', muted: false },
            { type: 'setMute', trackId: 't2', muted: true },
        ]);
    });

    it('keeps solo-safe and routed tracks audible in SIP mode', () => {
        const tracks = [
            TrackDummy.create({ id: 'bus', kind: 'bus', soloed: true }),
            TrackDummy.create({ id: 'src', outputId: 'bus' }),
            TrackDummy.create({ id: 'safe', soloSafe: true }),
            TrackDummy.create({ id: 'other' }),
        ];

        const result = applySoloLogic({
            tracks,
            soloMode: 'sip',
            savedGains: new Map(),
            liveStripTrackIds: new Set(['bus', 'src', 'safe', 'other']),
        });

        expect(result.actions).toEqual([
            { type: 'setMute', trackId: 'bus', muted: false },
            { type: 'setMute', trackId: 'src', muted: false },
            { type: 'setMute', trackId: 'safe', muted: false },
            { type: 'setMute', trackId: 'other', muted: true },
        ]);
    });

    it('terminates safely when routing contains a cycle', () => {
        const tracks = [
            TrackDummy.create({ id: 'solo', soloed: true }),
            TrackDummy.create({ id: 'a', outputId: 'b' }),
            TrackDummy.create({ id: 'b', outputId: 'a' }),
        ];

        const result = applySoloLogic({
            tracks,
            soloMode: 'sip',
            savedGains: new Map(),
            liveStripTrackIds: new Set(['solo', 'a', 'b']),
        });

        expect(result.actions).toEqual([
            { type: 'setMute', trackId: 'solo', muted: false },
            { type: 'setMute', trackId: 'a', muted: true },
            { type: 'setMute', trackId: 'b', muted: true },
        ]);
    });

    it('saves and restores PFL gains without mutating the input state', () => {
        const savedGains = new Map<string, number>();
        const soloedTracks = [
            TrackDummy.create({ id: 't1', gain: 0.5, soloed: true }),
            TrackDummy.create({ id: 't2', gain: 0.8, muted: true }),
        ];

        const soloedResult = applySoloLogic({
            tracks: soloedTracks,
            soloMode: 'pfl',
            savedGains,
            liveStripTrackIds: new Set(['t1', 't2']),
        });

        expect(soloedResult.actions).toEqual([
            { type: 'setGain', trackId: 't1', gain: 1.0 },
            { type: 'setMute', trackId: 't1', muted: false },
            { type: 'setMute', trackId: 't2', muted: true },
        ]);
        expect(savedGains).toEqual(new Map());
        expect(soloedResult.savedGains).toEqual(new Map([['t1', 0.5]]));

        const clearedResult = applySoloLogic({
            tracks: soloedTracks.map((track) => ({ ...track, soloed: false })),
            soloMode: 'pfl',
            savedGains: soloedResult.savedGains,
            liveStripTrackIds: new Set(['t1', 't2']),
        });

        expect(clearedResult.actions).toEqual([
            { type: 'setGain', trackId: 't1', gain: 0.5 },
            { type: 'setMute', trackId: 't1', muted: false },
            { type: 'setMute', trackId: 't2', muted: true },
        ]);
        expect(clearedResult.savedGains).toEqual(new Map());
    });

    it('acts on an eligible Toaster folder while ignoring a soloed ordinary folder', () => {
        const tracks = [
            TrackDummy.create({ id: 'folder-1', kind: 'folder', muted: true, soloed: true }),
            TrackDummy.create({ id: 'toaster-1', kind: 'folder', muted: false }),
        ];

        const result = applySoloLogic({
            tracks,
            soloMode: 'sip',
            savedGains: new Map(),
            liveStripTrackIds: new Set(['toaster-1']),
        });

        expect(result.actions).toEqual([{ type: 'setMute', trackId: 'toaster-1', muted: false }]);
    });
});
