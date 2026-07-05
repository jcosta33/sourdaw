import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';

import { TrackDummy } from '../../__tests__/TrackDummy';
import { normalizeTrack, type Clip } from '../../models/Track';
import { defaultTrackState, trackStore, type TrackStoreState } from '../trackStore';

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

        expect(trackStore.value).toEqual({
            tracks: [],
            selectedTrackId: 'track-live',
            ghostClips: [live_ghost],
        });
    });

    it('should drop malformed track rows while valid neighboring rows survive normalizeTrack defaults', () => {
        const valid_track = { id: 'track-valid', name: 'Valid Track', kind: 'audio' };
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

    it('should ignore legacy persisted transient fields while preserving cached live transients', () => {
        const live_ghost = create_valid_clip({ id: 'ghost-live', trackId: 'track-live' });
        const legacy_ghost = create_valid_clip({ id: 'ghost-legacy', trackId: 'track-legacy' });
        const durable_track = TrackDummy.create({ id: 'track-durable', name: 'Durable Track' });
        trackStore.set({
            tracks: [TrackDummy.create({ id: 'track-cached', name: 'Cached Track' })],
            selectedTrackId: 'track-live',
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
            selectedTrackId: 'track-live',
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
});
