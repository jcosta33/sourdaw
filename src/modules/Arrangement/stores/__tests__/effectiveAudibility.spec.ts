import { describe, expect, it } from 'vitest';

import { TrackDummy } from '../../__tests__/TrackDummy';
import { deriveEffectiveAudibility, hasActiveSolo } from '../effectiveAudibility';

const audible = (tracks: Parameters<typeof deriveEffectiveAudibility>[0]['tracks'], soloMode: 'sip' | 'afl' | 'pfl') =>
    deriveEffectiveAudibility({
        tracks,
        soloMode,
        stripTrackIds: new Set(tracks.map((track) => track.id)),
    }).audibleByTrackId;

describe('deriveEffectiveAudibility', () => {
    it('follows individual mute state when nothing is soloed', () => {
        const tracks = [TrackDummy.create({ id: 'a', muted: false }), TrackDummy.create({ id: 'b', muted: true })];

        const map = audible(tracks, 'sip');

        expect(map.get('a')).toBe(true);
        expect(map.get('b')).toBe(false);
    });

    it('silences non-soloed, non-routed tracks while an SIP solo is engaged', () => {
        const tracks = [TrackDummy.create({ id: 'solo', soloed: true }), TrackDummy.create({ id: 'other' })];

        const map = audible(tracks, 'sip');

        expect(map.get('solo')).toBe(true);
        expect(map.get('other')).toBe(false);
    });

    it('keeps solo-safe and bus-routed tracks audible under an SIP solo', () => {
        const tracks = [
            TrackDummy.create({ id: 'bus', kind: 'bus', soloed: true }),
            TrackDummy.create({ id: 'feeds-bus', outputId: 'bus' }),
            TrackDummy.create({ id: 'safe', soloSafe: true }),
            TrackDummy.create({ id: 'other' }),
        ];

        const map = audible(tracks, 'sip');

        expect(map.get('bus')).toBe(true);
        expect(map.get('feeds-bus')).toBe(true);
        expect(map.get('safe')).toBe(true);
        expect(map.get('other')).toBe(false);
    });

    it('still bakes individual mute into a soloed track under SIP', () => {
        const tracks = [
            TrackDummy.create({ id: 'solo-muted', soloed: true, muted: true }),
            TrackDummy.create({ id: 'solo-live', soloed: true }),
        ];

        const map = audible(tracks, 'sip');

        expect(map.get('solo-muted')).toBe(false);
        expect(map.get('solo-live')).toBe(true);
    });

    it('overrides a soloed track mute under PFL but keeps non-routed tracks silent', () => {
        const tracks = [
            TrackDummy.create({ id: 'solo-muted', soloed: true, muted: true }),
            TrackDummy.create({ id: 'other' }),
        ];

        const map = audible(tracks, 'pfl');

        expect(map.get('solo-muted')).toBe(true);
        expect(map.get('other')).toBe(false);
    });

    it('terminates on a routing cycle without keeping the cycle audible', () => {
        const tracks = [
            TrackDummy.create({ id: 'solo', soloed: true }),
            TrackDummy.create({ id: 'a', outputId: 'b' }),
            TrackDummy.create({ id: 'b', outputId: 'a' }),
        ];

        const map = audible(tracks, 'sip');

        expect(map.get('solo')).toBe(true);
        expect(map.get('a')).toBe(false);
        expect(map.get('b')).toBe(false);
    });

    it('ignores solo on tracks that own no strip in the target runtime', () => {
        const tracks = [
            TrackDummy.create({ id: 'ghost-solo', soloed: true }),
            TrackDummy.create({ id: 'live', muted: false }),
        ];

        const result = deriveEffectiveAudibility({
            tracks,
            soloMode: 'sip',
            stripTrackIds: new Set(['live']),
        });

        expect(result.anySoloed).toBe(false);
        expect(result.audibleByTrackId.get('live')).toBe(true);
        expect(result.audibleByTrackId.has('ghost-solo')).toBe(false);
    });

    it('excludes the master track from the audibility map', () => {
        const tracks = [TrackDummy.create({ id: 'master', kind: 'master' }), TrackDummy.create({ id: 'a' })];

        const map = audible(tracks, 'sip');

        expect(map.has('master')).toBe(false);
        expect(map.get('a')).toBe(true);
    });
});

describe('hasActiveSolo', () => {
    it('is true only when a soloed non-master strip track exists', () => {
        const tracks = [TrackDummy.create({ id: 'a', soloed: true })];

        expect(hasActiveSolo({ tracks, stripTrackIds: new Set(['a']) })).toBe(true);
        expect(hasActiveSolo({ tracks, stripTrackIds: new Set() })).toBe(false);
    });

    it('ignores a soloed master track', () => {
        const tracks = [TrackDummy.create({ id: 'master', kind: 'master', soloed: true })];

        expect(hasActiveSolo({ tracks, stripTrackIds: new Set(['master']) })).toBe(false);
    });
});
