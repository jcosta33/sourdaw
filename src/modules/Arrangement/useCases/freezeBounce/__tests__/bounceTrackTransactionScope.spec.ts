import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
    runWithAutomergeStorageTransaction,
} from '#/infra/store/storage/createAutomergeStorage';

import { normalizeTrack, type Clip, type Track } from '../../../models/Track';
import { trackStore, type TrackStoreState } from '../../../stores/trackStore';
import { bounceTrack, type BounceOptions } from '../bounceTrack';

type CacheAudioBufferInput = {
    buffer: AudioBuffer;
    bufferId?: string;
};

type RenderTrackOffline = (
    track: Track,
    startBeat: number,
    endBeat: number,
    options?: unknown
) => Promise<AudioBuffer | null>;

type PushUndoEntry = (label: string, undoFn: () => void, redoFn: () => void) => void;

const mocks = vi.hoisted(() => ({
    cacheAudioBuffer: vi.fn<(input: CacheAudioBufferInput) => string>(),
    pushUndoEntry: vi.fn<PushUndoEntry>(),
    renderTrackOffline: vi.fn<RenderTrackOffline>(),
}));

// The AudioEngine and Command use-case barrels are mocked by name because the
// render itself is not under test here and the real barrels pull the whole
// engine/command graph into a spec whose subject is the storage transaction.
vi.mock('#/modules/AudioEngine/useCases', () => ({
    cacheAudioBuffer: mocks.cacheAudioBuffer,
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeUserAppAction: vi.fn(),
    pushUndoEntry: mocks.pushUndoEntry,
}));

vi.mock('../renderOffline', () => ({
    renderTrackOffline: mocks.renderTrackOffline,
}));

function createFakeAudioBuffer(): AudioBuffer {
    const channelData = new Float32Array(128);
    return {
        duration: 1,
        getChannelData: () => channelData,
        length: channelData.length,
        numberOfChannels: 2,
        sampleRate: 48000,
    } as unknown as AudioBuffer;
}

function createAudioClip(overrides: Partial<Clip>): Clip {
    return {
        id: 'clip-source',
        trackId: 'track-1',
        name: 'Audio Clip',
        startBeat: 0,
        endBeat: 4,
        type: 'audio',
        audioBufferId: 'source-buffer',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '',
        locked: false,
        muted: false,
        ...overrides,
    };
}

function createAudioTrack(overrides: Partial<Track> = {}): Track {
    return normalizeTrack({
        id: 'track-1',
        name: 'Guitar',
        kind: 'audio',
        clips: [createAudioClip({})],
        ...overrides,
    });
}

const replaceBounce: BounceOptions = {
    includeInserts: true,
    includeSends: false,
    includeAutomation: true,
    normalization: 'protection',
    tailHandling: 'off',
    destination: 'replace',
};

// Issue #2544 — `bounceTrack` writes the bounced clip after awaiting
// `renderTrackOffline`. The dispatching command's storage transaction stops
// being ambient at that await (browsers have no async context propagation), so
// without a captured scope those writes got their own commit owner and their
// own animation frame: a bounce landed as an independent CRDT change that
// survived the abort of the command it belonged to. These specs hold the write
// inside the dispatching transaction, the same contract the audit CC-10 specs
// pin for `commitPitchEdit`.
describe('bounceTrack storage transaction scope (issue #2544)', () => {
    let doc: Record<string, unknown>;
    let trackMutations: string[];

    beforeEach(() => {
        vi.clearAllMocks();
        doc = {};
        trackMutations = [];
        configureAutomergeStoragePort({
            getDoc: () => doc,
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            mutateDoc: ({ docId, changedKeys, changeFn }) => {
                changeFn(doc);
                if (docId === 'root' && changedKeys.includes('tracks')) {
                    trackMutations.push(JSON.stringify(doc.tracks));
                }
            },
        });

        trackStore.set({
            tracks: [createAudioTrack()],
            selectedTrackId: 'track-1',
            ghostClips: [],
        } satisfies TrackStoreState);
        // Commit the seed so the transaction below starts from a persisted
        // baseline rather than from pending writes.
        flushAutomergeStorageWrites();

        mocks.renderTrackOffline.mockResolvedValue(createFakeAudioBuffer());
        mocks.cacheAudioBuffer.mockImplementation((input) => input.bufferId ?? 'generated-buffer-id');
    });

    afterEach(() => {
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
    });

    function seededTracksJson(): string {
        const seeded = trackMutations[0];
        if (seeded === undefined) {
            throw new Error('Expected the seed write to have reached the document');
        }
        return seeded;
    }

    async function flushOneFrame(): Promise<void> {
        await new Promise<void>((resolve) => {
            requestAnimationFrame(() => {
                resolve();
            });
        });
    }

    it('keeps the replace-destination write inside the dispatching transaction, off its own frame', async () => {
        const seed = seededTracksJson();
        const transaction = runWithAutomergeStorageTransaction(undefined, () => bounceTrack('track-1', replaceBounce));
        if (transaction.status !== 'returned') {
            throw transaction.error;
        }
        const didWrite = await transaction.value;
        expect(didWrite).toBe(true);

        // The render resolved and the bounce write was made — but it pends
        // inside the open transaction, so a whole animation frame later the
        // document still holds the pre-bounce truth.
        await flushOneFrame();
        expect(trackMutations).toHaveLength(1);

        transaction.commit();

        // One change for the whole bounce, committed by the transaction rather
        // than landing on its own frame.
        expect(trackMutations).toHaveLength(2);
        expect(trackMutations[1]).not.toBe(seed);
        expect(trackStore.value?.tracks[0]?.clips).toHaveLength(1);
        expect(trackStore.value?.tracks[0]?.clips[0]?.type).toBe('audio');
    });

    it('keeps the new-track-destination write inside the dispatching transaction', async () => {
        seededTracksJson();
        const transaction = runWithAutomergeStorageTransaction(undefined, () =>
            bounceTrack('track-1', { ...replaceBounce, destination: 'new-track' })
        );
        if (transaction.status !== 'returned') {
            throw transaction.error;
        }
        const didWrite = await transaction.value;
        expect(didWrite).toBe(true);

        await flushOneFrame();
        expect(trackMutations).toHaveLength(1);

        transaction.commit();

        expect(trackMutations).toHaveLength(2);
        expect(trackStore.value?.tracks).toHaveLength(2);
    });

    it('discards the post-render write when the dispatching transaction aborts', async () => {
        const seed = seededTracksJson();
        const transaction = runWithAutomergeStorageTransaction(undefined, () => bounceTrack('track-1', replaceBounce));
        if (transaction.status !== 'returned') {
            throw transaction.error;
        }
        const didWrite = await transaction.value;
        expect(didWrite).toBe(true);

        transaction.abort();
        flushAutomergeStorageWrites();

        // The render happened, but the command it belonged to was rolled
        // back — the destructive clip replacement may not survive it.
        expect(trackMutations).toHaveLength(1);
        expect(trackMutations[0]).toBe(seed);
        expect(trackStore.value?.tracks[0]?.clips[0]?.id).toBe('clip-source');
        expect(trackStore.value?.tracks[0]?.clips[0]?.audioBufferId).toBe('source-buffer');
    });
});
