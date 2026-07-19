import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type Dso } from '../../../models/DsoTypes';
import { resolveDsoNames } from '../resolveDsoNames';

const mocks = vi.hoisted(() => ({
    trackStoreValue: { value: null as unknown },
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: {
        get value() {
            return mocks.trackStoreValue.value;
        },
    },
}));

type TrackFixture = {
    id: string;
    name: string;
    clips?: Array<{ id: string; name: string }>;
    devices?: Array<{ id: string; type: string }>;
};

function trackState(tracks: TrackFixture[], selectedTrackId: string | null = null) {
    return {
        tracks: tracks.map((track) => ({
            id: track.id,
            name: track.name,
            clips: track.clips ?? [],
            devices: track.devices ?? [],
        })),
        selectedTrackId,
    };
}

const defaultTracks: TrackFixture[] = [
    { id: 't1', name: 'Drums', clips: [{ id: 'c1', name: 'Beat One' }], devices: [{ id: 'd1', type: 'reverb' }] },
    { id: 't2', name: 'Bass', clips: [], devices: [] },
    { id: 't3', name: 'Drum Bus Send', clips: [], devices: [] },
];

describe('resolveDsoNames', () => {
    beforeEach(() => {
        mocks.trackStoreValue.value = trackState(defaultTracks);
    });

    it('returns no errors and leaves DSOs untouched when the store has no value', () => {
        mocks.trackStoreValue.value = null;
        const dso = { op: 'mute_track' as const, track_id: 'Drums', muted: true };
        expect(resolveDsoNames([dso])).toEqual([]);
        expect(dso.track_id).toBe('Drums');
    });

    it('leaves an already-resolved track id untouched', () => {
        const dso = { op: 'mute_track' as const, track_id: 't1', muted: true };
        expect(resolveDsoNames([dso])).toEqual([]);
        expect(dso.track_id).toBe('t1');
    });

    it('resolves track_id via an exact case-insensitive name match', () => {
        const dso = { op: 'mute_track' as const, track_id: 'drums', muted: true };
        expect(resolveDsoNames([dso])).toEqual([]);
        expect(dso.track_id).toBe('t1');
    });

    it.each([
        { query: 'dru', expectedId: 't1' },
        { query: 'bus drum', expectedId: 't3' },
        { query: 'Drms', expectedId: 't1' },
    ])('resolves track_id "$query" to $expectedId via fuzzy matching', ({ query, expectedId }) => {
        const dso = { op: 'mute_track' as const, track_id: query, muted: true };
        expect(resolveDsoNames([dso])).toEqual([]);
        expect(dso.track_id).toBe(expectedId);
    });

    it('falls back to the selected track when the name references it and no match is found', () => {
        mocks.trackStoreValue.value = trackState(defaultTracks, 't2');
        const dso = { op: 'mute_track' as const, track_id: 'the current track', muted: true };
        expect(resolveDsoNames([dso])).toEqual([]);
        expect(dso.track_id).toBe('t2');
    });

    it('auto-creates an audio track for an unresolved name on an additive op', () => {
        const dso = {
            op: 'add_clip' as const,
            track_id: 'Lead Synth',
            name: 'Intro',
            type: 'audio' as const,
            start_beats: 0,
            end_beats: 4,
        };
        const dsos: Dso[] = [dso];
        expect(resolveDsoNames(dsos)).toEqual([]);
        expect(dsos).toHaveLength(2);
        expect(dsos[0]).toEqual({ op: 'add_track', name: 'Lead Synth', kind: 'audio', track_id: dso.track_id });
        expect(dso.track_id).toMatch(/^track-/);
    });

    it('infers a midi kind for the auto-created track when the op is generate_drums', () => {
        const dso = { op: 'generate_drums' as const, track_id: 'New Beat', style: 'rock', bars: 4, density: 0.5 };
        const dsos: Dso[] = [dso];
        resolveDsoNames(dsos);
        expect(dsos[0]).toMatchObject({ op: 'add_track', kind: 'midi' });
    });

    it('infers a midi kind for the auto-created track when the name mentions drums', () => {
        // Use a store with no track whose name would fuzzy-match "drum", so the
        // kind inference below is driven by the unresolved name hint, not a real match.
        mocks.trackStoreValue.value = trackState([{ id: 't2', name: 'Bass', clips: [], devices: [] }]);
        const dso = {
            op: 'add_clip' as const,
            track_id: 'Drum Loop',
            name: 'x',
            type: 'audio' as const,
            start_beats: 0,
            end_beats: 1,
        };
        const dsos: Dso[] = [dso];
        resolveDsoNames(dsos);
        expect(dsos[0]).toMatchObject({ op: 'add_track', kind: 'midi' });
    });

    it('reuses the same auto-created track for a second DSO referencing the same unresolved name', () => {
        const first = {
            op: 'add_clip' as const,
            track_id: 'Lead Synth',
            name: 'A',
            type: 'audio' as const,
            start_beats: 0,
            end_beats: 4,
        };
        const second = {
            op: 'add_clip' as const,
            track_id: 'Lead Synth',
            name: 'B',
            type: 'audio' as const,
            start_beats: 4,
            end_beats: 8,
        };
        const dsos: Dso[] = [first, second];
        expect(resolveDsoNames(dsos)).toEqual([]);
        expect(dsos).toHaveLength(3);
        expect(dsos.filter((entry) => entry.op === 'add_track')).toHaveLength(1);
        expect(first.track_id).toBe(second.track_id);
    });

    it('pushes a resolution error instead of auto-creating for a non-additive op referencing an unresolved track', () => {
        const dso = { op: 'mute_track' as const, track_id: 'Nonexistent Track', muted: true };
        const result = resolveDsoNames([dso]);
        expect(result).toEqual([{ dso, reason: 'Could not find track "Nonexistent Track"' }]);
        expect(dso.track_id).toBe('Nonexistent Track');
    });

    it('does not create or error for add_track DSOs with an unresolved track_id', () => {
        const dso = { op: 'add_track' as const, name: 'New', kind: 'audio' as const, track_id: 'unresolved-placeholder' };
        expect(resolveDsoNames([dso])).toEqual([]);
        expect(dso.track_id).toBe('unresolved-placeholder');
    });

    it('resolves destination_track_id and reports an error when it cannot be found', () => {
        const ok = { op: 'move_clip' as const, clip_id: 'c1', destination_track_id: 'bass', destination_start_beats: 0 };
        expect(resolveDsoNames([ok])).toEqual([]);
        expect(ok.destination_track_id).toBe('t2');

        const bad = { op: 'move_clip' as const, clip_id: 'c1', destination_track_id: 'nowhere', destination_start_beats: 0 };
        expect(resolveDsoNames([bad])).toEqual([{ dso: bad, reason: 'Could not find destination track "nowhere"' }]);
    });

    it('resolves from_track_id and to_track_id independently and reports which side failed', () => {
        const fromMissing = { op: 'create_send' as const, from_track_id: 'nowhere', to_track_id: 't2', gain: 0.5 };
        expect(resolveDsoNames([fromMissing])).toEqual([
            { dso: fromMissing, reason: 'Could not find source track "nowhere"' },
        ]);
        expect(fromMissing.to_track_id).toBe('t2');

        const toMissing = { op: 'create_send' as const, from_track_id: 't1', to_track_id: 'nowhere', gain: 0.5 };
        expect(resolveDsoNames([toMissing])).toEqual([
            { dso: toMissing, reason: 'Could not find target track "nowhere"' },
        ]);
        expect(toMissing.from_track_id).toBe('t1');
    });

    it('resolves clip_id by exact id and by partial name, and reports an error when unresolved', () => {
        const byId = { op: 'remove_clip' as const, clip_id: 'c1' };
        expect(resolveDsoNames([byId])).toEqual([]);
        expect(byId.clip_id).toBe('c1');

        const byName = { op: 'rename_clip' as const, clip_id: 'beat', name: 'Renamed' };
        expect(resolveDsoNames([byName])).toEqual([]);
        expect(byName.clip_id).toBe('c1');

        const missing = { op: 'split_clip' as const, clip_id: 'nowhere', split_at_beats: 4 };
        expect(resolveDsoNames([missing])).toEqual([{ dso: missing, reason: 'Could not find clip "nowhere"' }]);
    });

    it('resolves device_id "latest" without matching, resolves by type, and reports an error when unresolved', () => {
        const latest = { op: 'remove_device' as const, device_id: 'latest', track_id: 't1' };
        expect(resolveDsoNames([latest])).toEqual([]);
        expect(latest.device_id).toBe('latest');

        const byType = { op: 'bypass_device' as const, device_id: 'reverb', bypassed: true };
        expect(resolveDsoNames([byType])).toEqual([]);
        expect(byType.device_id).toBe('d1');

        const missing = { op: 'bypass_device' as const, device_id: 'nowhere', bypassed: true };
        expect(resolveDsoNames([missing])).toEqual([{ dso: missing, reason: 'Could not find device "nowhere"' }]);
    });

    it('processes multiple DSOs in one call, only failing the ones that cannot resolve', () => {
        const good = { op: 'mute_track' as const, track_id: 't1', muted: true };
        const bad = { op: 'solo_track' as const, track_id: 'nowhere', soloed: true };
        const dsos: Dso[] = [good, bad];
        expect(resolveDsoNames(dsos)).toEqual([{ dso: bad, reason: 'Could not find track "nowhere"' }]);
        expect(good.track_id).toBe('t1');
    });
});
