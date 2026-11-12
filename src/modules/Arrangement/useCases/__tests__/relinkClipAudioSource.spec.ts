import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import { clearUndoHistory, undo, redo } from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    getCrdtDoc,
    removeCrdtDoc,
    registerCrdtStorageRuntime,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import {
    arrangementStore,
    defaultArrangementId,
    projectStore,
    defaultProjectStoreState,
} from '#/modules/Project/stores';
import { runProjectLoadTransaction, setProjectIdentityTransitionDependencies } from '#/modules/Project/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { TrackDummy } from '../../__tests__/TrackDummy';
import { type Clip } from '../../models/Track';
import { trackStore } from '../../stores/trackStore';
import { captureRelinkAudioSourceCommitValidation } from '../clipEditing/captureRelinkAudioSourceCommitValidation';
import { relinkAudioSourceTargetsMatch } from '../clipEditing/relinkAudioSourceTargetsMatch';
import { getArrangementHandlers } from '../getArrangementHandlers';
import { relinkClipAudioSource } from '../relinkClipAudioSource';

const mocks = vi.hoisted(() => ({
    getCachedAudioBuffer: vi.fn<(input: { bufferId: string }) => AudioBuffer | null>(),
    clearClipPitchAnalysis: vi.fn<(clipId: string) => void>(),
    resolveEligibleClipWriteTarget:
        vi.fn<
            (input: {
                clipId?: string;
                trackId?: string;
            }) => { status: 'eligible'; trackId: string; clipId?: string } | { status: 'missing' | 'ineligible' }
        >(),
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    getCachedAudioBuffer: mocks.getCachedAudioBuffer,
}));
vi.mock('#/modules/Knead/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Knead/useCases')>()),
    clearClipPitchAnalysis: mocks.clearClipPitchAnalysis,
}));
vi.mock('../../stores/resolveEligibleClipWriteTarget', () => ({
    resolveEligibleClipWriteTarget: mocks.resolveEligibleClipWriteTarget,
}));

type ArrangementStoreValue = NonNullable<Parameters<typeof arrangementStore.set>[0]>;
type StoredSnapshot = ArrangementStoreValue['arrangements'][number];
type StoredTrack = StoredSnapshot['tracks']['tracks'][number];
type StoredClip = StoredTrack['clips'][number];

const decodedBuffer = {} as AudioBuffer;

const clipA: Clip = {
    id: 'clip-a',
    trackId: 'track-1',
    name: 'A',
    startBeat: 0,
    endBeat: 4,
    type: 'audio',
    audioBufferId: 'buf-missing',
    audioOffsetBeats: 2,
    fadeInBeats: 0.25,
    fadeOutBeats: 0.75,
    gain: 1.25,
    color: '',
    locked: false,
    muted: false,
};

const clipB: Clip = {
    ...clipA,
    id: 'clip-b',
    trackId: 'track-2',
    name: 'B',
    startBeat: 8,
    endBeat: 12,
    audioOffsetBeats: 0.5,
};

function storedClip(overrides?: Partial<StoredClip>): StoredClip {
    return {
        id: 'stored-clip',
        trackId: 'stored-track',
        name: 'Stored',
        startBeat: 0,
        endBeat: 4,
        type: 'audio',
        audioBufferId: 'buf-missing',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '',
        locked: false,
        muted: false,
        ...overrides,
    };
}

function storedTrack(overrides?: Partial<StoredTrack>): StoredTrack {
    return {
        id: 'stored-track',
        name: 'Stored track',
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        color: '#00ff00',
        clips: [storedClip()],
        devices: [],
        sends: [],
        midiFx: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 80,
        outputId: 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: 'stored-track-alt',
        alternatives: [{ id: 'stored-track-alt', name: 'Alternative 1', clips: [] }],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
        ...overrides,
    };
}

function storedSnapshot(id: string, tracks: StoredTrack[]): StoredSnapshot {
    return {
        id,
        name: `Arrangement ${id}`,
        tracks: { tracks, selectedTrackId: null },
        automation: { lanes: [] },
        midi: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
    };
}

function expectLiveClipBufferIds(bufferIds: readonly (string | undefined)[]): void {
    const live = trackStore.value?.tracks.flatMap((track) => track.clips.map((clip) => clip.audioBufferId)) ?? [];
    expect(live).toEqual(bufferIds);
}

describe('relinkClipAudioSource', () => {
    afterEach(() => {
        flushAutomergeStorageWrites();
        clearHandlerRegistry();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });
    beforeEach(async () => {
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: async () => undefined });
        const transition = runProjectLoadTransaction();
        expect(await transition.prepare()).toBe(true);
        expect(transition.activate()).toBe(true);
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('relink owning fixture');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        projectStore.set({ ...defaultProjectStoreState, loading: false });
        vi.clearAllMocks();
        // A null from the cache is what "missing" means; tests that need a
        // resolved source override this.
        mocks.getCachedAudioBuffer.mockReturnValue(null);
        mocks.resolveEligibleClipWriteTarget.mockImplementation(({ clipId, trackId }) => ({
            status: 'eligible',
            trackId: trackId ?? (clipId === 'clip-a' ? 'track-1' : 'track-2'),
            clipId,
        }));
        trackStore.set({
            tracks: [
                TrackDummy.create({ id: 'track-1', clips: [clipA] }),
                TrackDummy.create({ id: 'track-2', clips: [clipB] }),
            ],
            selectedTrackId: null,
        });
        arrangementStore.set({ arrangements: [], activeArrangementId: defaultArrangementId });
        flushAutomergeStorageWrites();
    });

    it('relinks every clip sharing the missing source across tracks and keeps each clip intact', async () => {
        const setTrackState = vi.spyOn(trackStore, 'set');

        const result = await relinkClipAudioSource({ sourceBufferId: 'buf-missing', replacementBufferId: 'buf-new' });

        expect(result).toEqual({ status: 'relinked', relinkedClipIds: ['clip-a', 'clip-b'] });
        expect(setTrackState).toHaveBeenCalledTimes(1);
        setTrackState.mockRestore();

        const first = trackStore.value?.tracks[0]?.clips[0];
        const second = trackStore.value?.tracks[1]?.clips[0];
        expect(first).toMatchObject({
            id: 'clip-a',
            audioBufferId: 'buf-new',
            startBeat: 0,
            endBeat: 4,
            audioOffsetBeats: 2,
            fadeInBeats: 0.25,
            fadeOutBeats: 0.75,
            gain: 1.25,
        });
        expect(second).toMatchObject({
            id: 'clip-b',
            audioBufferId: 'buf-new',
            startBeat: 8,
            endBeat: 12,
            audioOffsetBeats: 0.5,
        });
    });

    it('clears the stale pitch analysis of every relinked clip', async () => {
        await relinkClipAudioSource({ sourceBufferId: 'buf-missing', replacementBufferId: 'buf-new' });

        expect(mocks.clearClipPitchAnalysis.mock.calls.map((call) => call[0])).toEqual(['clip-a', 'clip-b']);
    });

    it('rejects active-snapshot addresses at projected and raw publication boundaries', () => {
        const owner = TrackDummy.create({
            id: 'track-1',
            clips: [clipA],
            activeAlternativeId: 'active',
            alternatives: [{ id: 'active', name: 'Active', clips: [clipA] }],
        });
        trackStore.set({ tracks: [owner], selectedTrackId: null });
        flushAutomergeStorageWrites();
        const targets: Extract<AppAction, { type: 'relinkClipAudioSources' }>['payload']['targets'] = [
            {
                trackId: owner.id,
                trackKind: owner.kind,
                activeAlternativeId: 'active',
                alternativeId: 'active',
                clipId: clipA.id,
                before: { audioBufferId: 'buf-missing', audioOffsetBeats: 2 },
                after: { audioBufferId: 'buf-new', audioOffsetBeats: 2 },
            },
        ];
        const document = getCrdtDoc<Record<string, unknown>>('root');
        if (!document) {
            throw new Error('Expected the committed track document');
        }
        const validation = captureRelinkAudioSourceCommitValidation(targets);
        expect(relinkAudioSourceTargetsMatch(targets)).toBe(false);
        expect(validation.beforeCommit()).not.toBeNull();
        expect(validation.beforeMutation).toBeTypeOf('function');
        expect(validation.beforeMutation!(document)).not.toBeNull();
        validation.release();
    });

    it('restores an omitted source pointer exactly when the clip ID is its missing cache key', async () => {
        const { audioBufferId: _source, ...withoutPointer } = clipA;
        trackStore.set({
            tracks: [TrackDummy.create({ id: 'track-1', clips: [withoutPointer] })],
            selectedTrackId: null,
        });
        flushAutomergeStorageWrites();
        expect(await relinkClipAudioSource({ sourceBufferId: 'clip-a', replacementBufferId: 'buf-new' })).toMatchObject(
            { status: 'relinked' }
        );
        await undo();
        const restored = trackStore.value?.tracks[0]?.clips[0];
        expect(restored).toBeDefined();
        expect(Object.hasOwn(restored!, 'audioBufferId')).toBe(false);
        await redo();
        expect(trackStore.value?.tracks[0]?.clips[0]?.audioBufferId).toBe('buf-new');
    });

    it('records one undo entry that restores both clips and redoes the relink', async () => {
        await relinkClipAudioSource({ sourceBufferId: 'buf-missing', replacementBufferId: 'buf-new' });

        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.past[0]?.label).toBe('Relink audio source');
        await undo();
        expectLiveClipBufferIds(['buf-missing', 'buf-missing']);
        await redo();
        expectLiveClipBufferIds(['buf-new', 'buf-new']);
    });

    it('does not clobber a clip already repaired onto the replacement buffer', async () => {
        trackStore.set({
            tracks: [
                TrackDummy.create({ id: 'track-1', clips: [clipA] }),
                TrackDummy.create({ id: 'track-2', clips: [{ ...clipB, audioBufferId: 'buf-new' }] }),
            ],
            selectedTrackId: null,
        });
        mocks.getCachedAudioBuffer.mockImplementation(({ bufferId }) =>
            bufferId === 'buf-new' ? decodedBuffer : null
        );

        const result = await relinkClipAudioSource({ sourceBufferId: 'buf-missing', replacementBufferId: 'buf-new' });

        expect(result).toEqual({ status: 'relinked', relinkedClipIds: ['clip-a'] });
        const second = trackStore.value?.tracks[1]?.clips[0];
        expect(second).toMatchObject({ id: 'clip-b', audioBufferId: 'buf-new' });
    });

    it('refuses to relink when the source buffer resolves in the cache at write time', async () => {
        mocks.getCachedAudioBuffer.mockReturnValue(decodedBuffer);
        const before = trackStore.value;

        const result = await relinkClipAudioSource({ sourceBufferId: 'buf-missing', replacementBufferId: 'buf-new' });

        expect(result).toEqual({ status: 'source-not-missing' });
        expect(trackStore.value).toBe(before);
        expect(undoStore.value?.past).toEqual([]);
        expect(mocks.clearClipPitchAnalysis).not.toHaveBeenCalled();
    });

    it('relinks inactive track-alternative clips carrying the same missing source', async () => {
        const alternativeClip: Clip = { ...clipA, id: 'clip-alt' };
        trackStore.set({
            tracks: [
                TrackDummy.create({
                    id: 'track-1',
                    clips: [clipA],
                    activeAlternativeId: 'alt-1',
                    alternatives: [
                        { id: 'alt-1', name: 'Alternative 1', clips: [] },
                        { id: 'alt-2', name: 'Alternative 2', clips: [alternativeClip] },
                    ],
                }),
            ],
            selectedTrackId: null,
        });

        const result = await relinkClipAudioSource({ sourceBufferId: 'buf-missing', replacementBufferId: 'buf-new' });

        expect(result).toEqual({ status: 'relinked', relinkedClipIds: ['clip-a', 'clip-alt'] });
        expect(trackStore.value?.tracks[0]?.clips[0]?.audioBufferId).toBe('buf-new');
        expect(trackStore.value?.tracks[0]?.alternatives[1]?.clips[0]).toMatchObject({
            id: 'clip-alt',
            audioBufferId: 'buf-new',
        });
    });

    it('leaves stored inactive arrangements untouched — the project aggregate owns them', async () => {
        const inactiveSnapshot = storedSnapshot('arrangement-2', [storedTrack()]);
        arrangementStore.set({
            arrangements: [storedSnapshot(defaultArrangementId, []), inactiveSnapshot],
            activeArrangementId: defaultArrangementId,
        });
        const storedBefore = structuredClone(arrangementStore.value);

        const result = await relinkClipAudioSource({ sourceBufferId: 'buf-missing', replacementBufferId: 'buf-new' });

        expect(result).toEqual({ status: 'relinked', relinkedClipIds: ['clip-a', 'clip-b'] });
        expect(arrangementStore.value).toEqual(storedBefore);
    });

    it('rejects without writing when no clip carries the missing source', async () => {
        const before = trackStore.value;

        const result = await relinkClipAudioSource({ sourceBufferId: 'buf-nowhere', replacementBufferId: 'buf-new' });

        expect(result).toEqual({ status: 'rejected' });
        expect(trackStore.value).toBe(before);
        expect(undoStore.value?.past).toEqual([]);
    });

    it('rejects atomically when an active matched clip fails the clip-write trust boundary', async () => {
        mocks.resolveEligibleClipWriteTarget.mockImplementation(({ clipId, trackId }) => {
            if (clipId === 'clip-b') {
                return { status: 'ineligible' };
            }
            return { status: 'eligible', trackId: trackId ?? 'track-1', clipId };
        });
        const before = trackStore.value;

        const result = await relinkClipAudioSource({ sourceBufferId: 'buf-missing', replacementBufferId: 'buf-new' });

        expect(result).toEqual({ status: 'rejected' });
        expect(trackStore.value).toBe(before);
        expect(mocks.clearClipPitchAnalysis).not.toHaveBeenCalled();
        expect(undoStore.value?.past).toEqual([]);
    });

    it('rejects empty ids without touching the store', async () => {
        const before = trackStore.value;

        expect(await relinkClipAudioSource({ sourceBufferId: '', replacementBufferId: 'buf-new' })).toEqual({
            status: 'rejected',
        });
        expect(await relinkClipAudioSource({ sourceBufferId: 'buf-missing', replacementBufferId: '' })).toEqual({
            status: 'rejected',
        });
        expect(trackStore.value).toBe(before);
    });

    it('rejects when the track store is uninitialized', async () => {
        trackStore.set(null);

        const result = await relinkClipAudioSource({ sourceBufferId: 'buf-missing', replacementBufferId: 'buf-new' });

        expect(result).toEqual({ status: 'rejected' });
    });
});
