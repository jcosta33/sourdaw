import { beforeEach, describe, expect, it, vi } from 'vitest';

import { arrangementStore, defaultArrangementId } from '#/modules/Project/stores';

import { TrackDummy } from '../../__tests__/TrackDummy';
import { type Clip } from '../../models/Track';
import { trackStore } from '../../stores/trackStore';
import { relinkClipAudioSource } from '../relinkClipAudioSource';

const mocks = vi.hoisted(() => ({
    pushUndoEntry:
        vi.fn<
            (
                label: string,
                undoFn: () => void,
                redoFn: () => unknown,
                options?: { restoresBufferIds?: readonly string[] }
            ) => void
        >(),
    getCachedAudioBuffer: vi.fn<(input: { bufferId: string }) => AudioBuffer | null>(),
    clearClipPitchAnalysis: vi.fn<(clipId: string) => void>(),
    resolveEligibleClipWriteTarget:
        vi.fn<
            (input: {
                clipId: string;
            }) => { status: 'eligible'; trackId: string; clipId: string } | { status: 'missing' | 'ineligible' }
        >(),
}));

vi.mock('#/modules/Command/useCases', () => ({
    pushUndoEntry: mocks.pushUndoEntry,
}));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    getCachedAudioBuffer: mocks.getCachedAudioBuffer,
}));
vi.mock('#/modules/Knead/useCases', () => ({
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

function capturedUndoEntry(): {
    label: string;
    undoFn: () => void;
    redoFn: () => unknown;
    options: { restoresBufferIds?: readonly string[] } | undefined;
} {
    const call = mocks.pushUndoEntry.mock.calls[0];
    if (!call) {
        throw new Error('expected pushUndoEntry to be called');
    }
    return { label: call[0], undoFn: call[1], redoFn: call[2], options: call[3] };
}

function expectLiveClipBufferIds(bufferIds: readonly (string | undefined)[]): void {
    const live = trackStore.value?.tracks.flatMap((track) => track.clips.map((clip) => clip.audioBufferId)) ?? [];
    expect(live).toEqual(bufferIds);
}

describe('relinkClipAudioSource', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // A null from the cache is what "missing" means; tests that need a
        // resolved source override this.
        mocks.getCachedAudioBuffer.mockReturnValue(null);
        mocks.resolveEligibleClipWriteTarget.mockImplementation(({ clipId }) => ({
            status: 'eligible',
            trackId: clipId === 'clip-a' ? 'track-1' : 'track-2',
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
    });

    it('relinks every clip sharing the missing source across tracks and keeps each clip intact', () => {
        const setTrackState = vi.spyOn(trackStore, 'set');

        const result = relinkClipAudioSource({ sourceBufferId: 'buf-missing', replacementBufferId: 'buf-new' });

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

    it('clears the stale pitch analysis of every relinked clip', () => {
        relinkClipAudioSource({ sourceBufferId: 'buf-missing', replacementBufferId: 'buf-new' });

        expect(mocks.clearClipPitchAnalysis.mock.calls.map((call) => call[0])).toEqual(['clip-a', 'clip-b']);
    });

    it('records one undo entry that restores both clips and redoes the relink', () => {
        relinkClipAudioSource({ sourceBufferId: 'buf-missing', replacementBufferId: 'buf-new' });

        expect(mocks.pushUndoEntry).toHaveBeenCalledTimes(1);
        const entry = capturedUndoEntry();
        expect(entry.label).toBe('Relink audio source');
        expect(entry.options).toEqual({ restoresBufferIds: ['buf-new'] });

        entry.undoFn();
        expectLiveClipBufferIds(['buf-missing', 'buf-missing']);

        entry.redoFn();
        expectLiveClipBufferIds(['buf-new', 'buf-new']);
    });

    it('does not clobber a clip already repaired onto the replacement buffer', () => {
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

        const result = relinkClipAudioSource({ sourceBufferId: 'buf-missing', replacementBufferId: 'buf-new' });

        expect(result).toEqual({ status: 'relinked', relinkedClipIds: ['clip-a'] });
        const second = trackStore.value?.tracks[1]?.clips[0];
        expect(second).toMatchObject({ id: 'clip-b', audioBufferId: 'buf-new' });
    });

    it('refuses to relink when the source buffer resolves in the cache at write time', () => {
        mocks.getCachedAudioBuffer.mockReturnValue(decodedBuffer);
        const before = trackStore.value;

        const result = relinkClipAudioSource({ sourceBufferId: 'buf-missing', replacementBufferId: 'buf-new' });

        expect(result).toEqual({ status: 'source-not-missing' });
        expect(trackStore.value).toBe(before);
        expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
        expect(mocks.clearClipPitchAnalysis).not.toHaveBeenCalled();
    });

    it('relinks inactive track-alternative clips carrying the same missing source', () => {
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

        const result = relinkClipAudioSource({ sourceBufferId: 'buf-missing', replacementBufferId: 'buf-new' });

        expect(result).toEqual({ status: 'relinked', relinkedClipIds: ['clip-a', 'clip-alt'] });
        expect(trackStore.value?.tracks[0]?.clips[0]?.audioBufferId).toBe('buf-new');
        expect(trackStore.value?.tracks[0]?.alternatives[1]?.clips[0]).toMatchObject({
            id: 'clip-alt',
            audioBufferId: 'buf-new',
        });
    });

    it('leaves stored inactive arrangements untouched — the project aggregate owns them', () => {
        const inactiveSnapshot = storedSnapshot('arrangement-2', [storedTrack()]);
        arrangementStore.set({
            arrangements: [storedSnapshot(defaultArrangementId, []), inactiveSnapshot],
            activeArrangementId: defaultArrangementId,
        });
        const storedBefore = structuredClone(arrangementStore.value);

        const result = relinkClipAudioSource({ sourceBufferId: 'buf-missing', replacementBufferId: 'buf-new' });

        expect(result).toEqual({ status: 'relinked', relinkedClipIds: ['clip-a', 'clip-b'] });
        expect(arrangementStore.value).toEqual(storedBefore);
    });

    it('rejects without writing when no clip carries the missing source', () => {
        const before = trackStore.value;

        const result = relinkClipAudioSource({ sourceBufferId: 'buf-nowhere', replacementBufferId: 'buf-new' });

        expect(result).toEqual({ status: 'rejected' });
        expect(trackStore.value).toBe(before);
        expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
    });

    it('rejects atomically when an active matched clip fails the clip-write trust boundary', () => {
        mocks.resolveEligibleClipWriteTarget.mockImplementation(({ clipId }) =>
            clipId === 'clip-b' ? { status: 'ineligible' } : { status: 'eligible', trackId: 'track-1', clipId }
        );
        const before = trackStore.value;

        const result = relinkClipAudioSource({ sourceBufferId: 'buf-missing', replacementBufferId: 'buf-new' });

        expect(result).toEqual({ status: 'rejected' });
        expect(trackStore.value).toBe(before);
        expect(mocks.clearClipPitchAnalysis).not.toHaveBeenCalled();
        expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
    });

    it('rejects empty ids without touching the store', () => {
        const before = trackStore.value;

        expect(relinkClipAudioSource({ sourceBufferId: '', replacementBufferId: 'buf-new' })).toEqual({
            status: 'rejected',
        });
        expect(relinkClipAudioSource({ sourceBufferId: 'buf-missing', replacementBufferId: '' })).toEqual({
            status: 'rejected',
        });
        expect(trackStore.value).toBe(before);
    });

    it('rejects when the track store is uninitialized', () => {
        trackStore.set(null);

        const result = relinkClipAudioSource({ sourceBufferId: 'buf-missing', replacementBufferId: 'buf-new' });

        expect(result).toEqual({ status: 'rejected' });
    });
});
