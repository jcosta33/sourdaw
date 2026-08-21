import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';

import { TrackDummy } from '../../__tests__/TrackDummy';
import { normalizeTrack, type Clip } from '../../models/Track';
import { defaultTrackState, sanitizeTrackSnapshot, trackStore, type TrackStoreState } from '../trackStore';

type TestDoc = {
    [key: string]: unknown;
};

type TestPort = NonNullable<Parameters<typeof configureAutomergeStoragePort>[0]>;

const fake_doc: TestDoc = {};
let mutation_count = 0;

function clear_fake_doc(): void {
    for (const key of Object.keys(fake_doc)) {
        delete fake_doc[key];
    }
}

function configure_fake_crdt_port(): void {
    const port: TestPort = {
        getDoc: () => fake_doc,
        getSemanticMessage: () => undefined,
        hasDoc: () => true,
        mutateDoc: ({ changeFn }) => {
            mutation_count += 1;
            changeFn(fake_doc);
        },
    };

    configureAutomergeStoragePort(port);
}

async function flush_pending_frame(): Promise<void> {
    await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
            resolve();
        });
    });
}

function create_default_state(): TrackStoreState {
    return structuredClone(defaultTrackState);
}

function create_valid_clip(input: { id: string; trackId: string }): Clip {
    return {
        id: input.id,
        trackId: input.trackId,
        name: 'Clip',
        startBeat: 0,
        endBeat: 4,
        type: 'audio',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#ff0000',
        locked: false,
        muted: false,
    };
}

async function reset_store_and_doc(): Promise<void> {
    configureAutomergeStoragePort(null);
    trackStore.set(create_default_state());
    await flush_pending_frame();
    clear_fake_doc();
    mutation_count = 0;
    configure_fake_crdt_port();
}

describe('trackStore', () => {
    beforeEach(async () => {
        await reset_store_and_doc();
    });

    afterEach(() => {
        configureAutomergeStoragePort(null);
    });

    it('should sanitize malformed tracks to safe project truth while preserving live transient fields', () => {
        const live_ghost = create_valid_clip({ id: 'ghost-live', trackId: 'track-live' });
        trackStore.set({
            tracks: [TrackDummy.create({ id: 'track-cached', name: 'Cached Track' })],
            selectedTrackId: 'track-live',
            ghostClips: [live_ghost],
        });
        fake_doc.tracks = { tracks: 'not-an-array' };

        expect(() => {
            trackStore.hydrate();
        }).not.toThrow();

        // `tracks` sanitizes to `[]` because the CRDT payload is malformed, so
        // `track-live` no longer exists in the hydrated snapshot: the selection
        // must null out rather than point at a track that is gone. `ghostClips`
        // is untouched because it is not re-validated against `tracks`.
        expect(trackStore.value).toEqual({
            tracks: [],
            selectedTrackId: null,
            ghostClips: [live_ghost],
        });
    });

    it('should null out selectedTrackId when the previously selected track no longer exists after CRDT hydration', () => {
        // Regression guard: `sanitize_track_store_state_from_crdt` used to merge
        // the live transient `selectedTrackId` back in unconditionally after
        // hydration, bypassing the null-out `sanitizeTrackSnapshot` already
        // applies. A collab peer deleting the locally selected track (or any
        // hydration that drops it) left `selectedTrackId` pointing at nothing.
        const surviving_track = TrackDummy.create({ id: 'track-durable', name: 'Durable Track' });
        trackStore.set({
            tracks: [TrackDummy.create({ id: 'track-deleted', name: 'Deleted Track' })],
            selectedTrackId: 'track-deleted',
            ghostClips: [],
        });
        fake_doc.tracks = { tracks: [surviving_track] };

        trackStore.hydrate();

        expect(trackStore.value?.tracks).toEqual([normalizeTrack(surviving_track)]);
        expect(trackStore.value?.selectedTrackId).toBeNull();
    });

    it('should drop malformed track rows while valid neighboring rows survive normalizeTrack defaults', () => {
        const valid_track = { id: 'track-valid', name: 'Valid Track', kind: 'audio' as const };
        fake_doc.tracks = {
            tracks: [
                'not-a-track',
                { id: 'track-missing-kind', name: 'Missing Kind' },
                { id: 'track-bad-kind', name: 'Bad Kind', kind: 'wrong' },
                valid_track,
            ],
        };

        trackStore.hydrate();

        expect(trackStore.value?.tracks).toEqual([normalizeTrack(valid_track)]);
    });

    it('should default malformed optional and nested fields without dropping a valid parent track', () => {
        fake_doc.tracks = {
            tracks: [
                {
                    id: 'track-valid',
                    name: 'Valid Track',
                    kind: 'midi',
                    clips: 'not-clips',
                    devices: 'not-devices',
                    sends: 'not-sends',
                    midiFx: 'not-midi-fx',
                    alternatives: 'not-alternatives',
                    inputMonitoring: 'sometimes',
                    automationMode: 'scribble',
                    freezeState: { status: 'glazed', errorMessage: 'bad status' },
                    stale: true,
                },
            ],
        };

        trackStore.hydrate();

        expect(trackStore.value?.tracks).toEqual([
            normalizeTrack({
                id: 'track-valid',
                name: 'Valid Track',
                kind: 'midi',
            }),
        ]);
    });

    it('should drop non-object elements from nested collections while preserving valid siblings', () => {
        // Each collection array mixes a non-object element (null / primitive)
        // with a valid element; the normalizers must filter the bad one out
        // and keep the good one rather than dropping the whole track.
        fake_doc.tracks = {
            tracks: [
                {
                    id: 'track-mixed',
                    name: 'Mixed',
                    kind: 'midi',
                    clips: [null, create_valid_clip({ id: 'clip-good', trackId: 'track-mixed' })],
                    devices: [
                        'bad-device',
                        { id: 'd1', name: 'Dev', type: 'eq', bypassed: false, parameterValues: {} },
                    ],
                    sends: [42, { busId: 'bus-1', level: 0.5, preFader: true }],
                    midiFx: [null, { id: 'fx1', type: 'arp' }],
                    alternatives: ['not-an-alternative', { id: 'alt-good', name: 'Good Alt', clips: [] }],
                },
            ],
        };

        trackStore.hydrate();

        const track = trackStore.value?.tracks[0];
        expect(track?.clips.map((context) => context.id)).toEqual(['clip-good']);
        expect(track?.devices.map((device) => device.id)).toEqual(['d1']);
        expect(track?.sends.map((send) => send.busId)).toEqual(['bus-1']);
        expect(track?.midiFx.map((fx) => fx.id)).toEqual(['fx1']);
        expect(track?.alternatives.map((alt) => alt.id)).toEqual(['alt-good']);
    });

    it('should drop non-object knead blobs while preserving valid siblings in knead state', () => {
        const valid_blob = {
            id: 'blob-good',
            startTime: 0,
            endTime: 1,
            pitchCenterCents: 0,
            pitchCurveCents: [0, 100],
            voicedConfidence: 0.5,
        };
        fake_doc.tracks = {
            tracks: [
                {
                    id: 'track-knead',
                    name: 'Knead',
                    kind: 'audio',
                    clips: [
                        {
                            ...create_valid_clip({ id: 'clip-knead', trackId: 'track-knead' }),
                            kneadState: {
                                blobs: ['not-a-blob', valid_blob],
                                retuneSpeedMs: 50,
                                humanizePercent: 0,
                                formantPreserve: true,
                            },
                        },
                    ],
                },
            ],
        };

        trackStore.hydrate();

        const clip = trackStore.value?.tracks[0]?.clips[0];
        expect(clip?.kneadState?.blobs.map((blob) => blob.id)).toEqual(['blob-good']);
    });

    it('should ignore legacy persisted transient fields while preserving cached live transients', () => {
        // The live transient selection points at `track-durable`, which is also
        // the track the CRDT hydration brings in below — so this pins
        // "preserve the live selection" without relying on the F15 defect
        // (merging a selection back in without checking it still exists).
        const live_ghost = create_valid_clip({ id: 'ghost-live', trackId: 'track-live' });
        const legacy_ghost = create_valid_clip({ id: 'ghost-legacy', trackId: 'track-legacy' });
        const durable_track = TrackDummy.create({ id: 'track-durable', name: 'Durable Track' });
        trackStore.set({
            tracks: [TrackDummy.create({ id: 'track-cached', name: 'Cached Track' })],
            selectedTrackId: 'track-durable',
            ghostClips: [live_ghost],
        });
        fake_doc.tracks = {
            tracks: [durable_track],
            selectedTrackId: 'track-legacy',
            ghostClips: [legacy_ghost],
        };

        trackStore.hydrate();

        expect(trackStore.value).toEqual({
            tracks: [normalizeTrack(durable_track)],
            selectedTrackId: 'track-durable',
            ghostClips: [live_ghost],
        });
    });

    it('should ignore legacy persisted transient fields on cold-start hydration', () => {
        const legacy_ghost = create_valid_clip({ id: 'ghost-cold-legacy', trackId: 'track-cold-legacy' });
        const durable_track = TrackDummy.create({ id: 'track-cold-durable', name: 'Cold Durable Track' });
        fake_doc.tracks = {
            tracks: [durable_track],
            selectedTrackId: 'track-cold-legacy',
            ghostClips: [legacy_ghost],
        };

        trackStore.hydrate();

        expect(trackStore.value).toEqual({
            tracks: [normalizeTrack(durable_track)],
            selectedTrackId: null,
            ghostClips: [],
        });
    });

    it('should not write back when clean CRDT tracks hydrate exactly', async () => {
        const clip_with_known_optionals: Clip = {
            ...create_valid_clip({ id: 'clip-clean', trackId: 'track-clean' }),
            overrides: { gain: true },
            kneadState: {
                blobs: [
                    {
                        id: 'blob-1',
                        startTime: 0,
                        endTime: 1,
                        pitchCenterCents: 25,
                        pitchCurveCents: [0, 10, 20],
                        voicedConfidence: 0.9,
                    },
                ],
                retuneSpeedMs: 50,
                humanizePercent: 10,
                formantPreserve: true,
            },
        };
        const valid_state = {
            tracks: [TrackDummy.create({ id: 'track-clean', name: 'Clean Track', clips: [clip_with_known_optionals] })],
            selectedTrackId: null,
            ghostClips: [],
        } satisfies TrackStoreState;
        fake_doc.tracks = { tracks: valid_state.tracks };

        trackStore.hydrate();
        await flush_pending_frame();

        expect(trackStore.value).toEqual(valid_state);
        expect(mutation_count).toBe(0);
    });

    it('should preserve and hydrate fileId on audio clips through sanitizeTrackSnapshot and store hydration', async () => {
        const audio_clip: Clip = {
            ...create_valid_clip({ id: 'clip-audio-file', trackId: 'track-audio' }),
            fileId: 'project/audio/recording-1.wav',
        };
        const track = TrackDummy.create({
            id: 'track-audio',
            name: 'Audio Track',
            kind: 'audio',
            clips: [audio_clip],
        });

        const sanitized = sanitizeTrackSnapshot({
            tracks: [track],
            selectedTrackId: 'track-audio',
        });
        expect(sanitized.tracks[0]?.clips[0]?.fileId).toBe('project/audio/recording-1.wav');

        fake_doc.tracks = { tracks: [track] };
        trackStore.hydrate();
        await flush_pending_frame();

        expect(trackStore.value?.tracks[0]?.clips[0]?.fileId).toBe('project/audio/recording-1.wav');
    });
});
