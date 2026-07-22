import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { normalizeTrack, type Clip, type Track } from '../../../models/Track';
import { bounceSelection } from '../bounceSelection';

import type { TrackStoreState } from '../../../stores/trackStore';

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

const mocks = vi.hoisted(() => {
    type TestTrackStore = {
        value: TrackStoreState | null;
        set: ReturnType<typeof vi.fn<(state: TrackStoreState) => void>>;
    };

    const trackStore: TestTrackStore = {
        value: null,
        set: vi.fn<(state: TrackStoreState) => void>(),
    };

    return {
        cacheAudioBuffer: vi.fn<(input: CacheAudioBufferInput) => string>(),
        pushUndoEntry: vi.fn<PushUndoEntry>(),
        renderTrackOffline: vi.fn<RenderTrackOffline>(),
        trackStore,
    };
});

vi.mock('#/modules/AudioEngine/useCases', () => ({
    cacheAudioBuffer: mocks.cacheAudioBuffer,
}));

vi.mock('#/modules/Command/useCases', () => ({
    pushUndoEntry: mocks.pushUndoEntry,
}));

vi.mock('../../../stores/trackStore', () => ({
    trackStore: mocks.trackStore,
}));

vi.mock('../renderOffline', () => ({
    renderTrackOffline: mocks.renderTrackOffline,
}));

const midiMocks = vi.hoisted(() => {
    const state: {
        value: {
            notesByClipId: Record<string, Array<Record<string, unknown>>>;
            ccByClipId: Record<string, Array<Record<string, unknown>>>;
            pitchBendByClipId: Record<string, Array<Record<string, unknown>>>;
        } | null;
    } = { value: null };

    function setValue(next: NonNullable<typeof state.value>): void {
        state.value = next;
    }

    return {
        state,
        splitMidiNotesAtBeat: vi.fn(
            (input: { sourceClipId: string; newClipId: string; splitBeat: number; discardBeforeBeat?: number }) => {
                // Behavior-faithful partition: drop notes in
                // [discardBeforeBeat, splitBeat), re-base notes >= splitBeat
                // onto the new clip at -splitBeat, trim straddlers.
                const s = state.value;
                if (!s) {
                    return;
                }
                const source = s.notesByClipId[input.sourceClipId] ?? [];
                const discardBefore = input.discardBeforeBeat ?? Number.NEGATIVE_INFINITY;
                const kept: Array<Record<string, unknown>> = [];
                const moved: Array<Record<string, unknown>> = [];
                for (const note of source) {
                    const start = note.startBeat as number;
                    if (start >= input.splitBeat) {
                        moved.push({ ...note, startBeat: start - input.splitBeat });
                    } else if (start < discardBefore) {
                        kept.push(note);
                    }
                }
                const notesByClipId = { ...s.notesByClipId, [input.sourceClipId]: kept };
                if (moved.length > 0) {
                    notesByClipId[input.newClipId] = moved;
                }
                setValue({ ...s, notesByClipId });
            }
        ),
    };
});

vi.mock('#/modules/MIDI/useCases', () => ({
    getMidiStoreState: () => midiMocks.state.value,
    removeMidiClipData: (clipIds: readonly string[]) => {
        const s = midiMocks.state.value;
        if (!s) {
            return;
        }
        const notesByClipId = { ...s.notesByClipId };
        const ccByClipId = { ...s.ccByClipId };
        const pitchBendByClipId = { ...s.pitchBendByClipId };
        for (const id of clipIds) {
            delete notesByClipId[id];
            delete ccByClipId[id];
            delete pitchBendByClipId[id];
        }
        midiMocks.state.value = { ...s, notesByClipId, ccByClipId, pitchBendByClipId };
    },
    restoreMidiClipData: (input: {
        clipId: string;
        notesSnapshot: readonly unknown[] | null;
        controlChangeSnapshot: readonly unknown[] | null;
        pitchBendSnapshot: readonly unknown[] | null;
    }) => {
        const s = midiMocks.state.value;
        if (!s) {
            return;
        }
        if (input.notesSnapshot === null && input.controlChangeSnapshot === null && input.pitchBendSnapshot === null) {
            return;
        }
        const notesByClipId = { ...s.notesByClipId };
        const ccByClipId = { ...s.ccByClipId };
        const pitchBendByClipId = { ...s.pitchBendByClipId };
        if (input.notesSnapshot !== null) {
            notesByClipId[input.clipId] = [...input.notesSnapshot] as Array<Record<string, unknown>>;
        }
        if (input.controlChangeSnapshot !== null) {
            ccByClipId[input.clipId] = [...input.controlChangeSnapshot] as Array<Record<string, unknown>>;
        }
        if (input.pitchBendSnapshot !== null) {
            pitchBendByClipId[input.clipId] = [...input.pitchBendSnapshot] as Array<Record<string, unknown>>;
        }
        midiMocks.state.value = { ...s, notesByClipId, ccByClipId, pitchBendByClipId };
    },
    splitMidiNotesAtBeat: midiMocks.splitMidiNotesAtBeat,
}));

function createTestAudioBuffer(): AudioBuffer {
    const channelData = new Float32Array(128);

    return {
        copyFromChannel: (destination, _channelNumber, bufferOffset = 0) => {
            destination.set(channelData.subarray(bufferOffset, bufferOffset + destination.length));
        },
        copyToChannel: (source, _channelNumber, bufferOffset = 0) => {
            channelData.set(source, bufferOffset);
        },
        duration: 1,
        getChannelData: () => channelData,
        length: channelData.length,
        numberOfChannels: 2,
        sampleRate: 48000,
    };
}

function createAudioClip(overrides: Partial<Clip>): Clip {
    return {
        id: 'clip-1',
        trackId: 'track-1',
        name: 'Audio Clip',
        startBeat: 0,
        endBeat: 4,
        type: 'audio',
        audioBufferId: 'source-buffer-1',
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

function setTrackStoreState(state: TrackStoreState): void {
    mocks.trackStore.value = state;
}

function getFirstUndoEntry(): [string, () => void, () => void] {
    const call = mocks.pushUndoEntry.mock.calls[0];
    if (!call) {
        throw new Error('Expected an undo entry to be pushed');
    }

    return [call[0], call[1], call[2]];
}

describe('bounceSelection', () => {
    it('splits partially-overlapping clips at the selection edges and cleans removed MIDI data (regression: ledger M-031)', async () => {
        // Left-crossing clip [0,4), fully-inside [4,6), right-crossing [6,10)
        // with the selection at [2,8). Pre-fix, the crossing clips were
        // deleted wholesale and the inside clip's MIDI orphaned.
        const leftCrossing = createAudioClip({ id: 'left-crossing', startBeat: 0, endBeat: 4, type: 'midi' });
        const fullyInside = createAudioClip({ id: 'fully-inside', startBeat: 4, endBeat: 6, type: 'midi' });
        const rightCrossing = createAudioClip({ id: 'right-crossing', startBeat: 6, endBeat: 10, type: 'midi' });
        const track: Track = normalizeTrack({
            id: 'track-1',
            name: 'Track 1',
            kind: 'midi',
            muted: false,
            clips: [leftCrossing, fullyInside, rightCrossing],
        } as unknown as Track);
        mocks.trackStore.value = { tracks: [track], selectedTrackId: 'track-1', ghostClips: [] };
        mocks.renderTrackOffline.mockResolvedValue(createTestAudioBuffer());

        const result = await bounceSelection('track-1', 2, 8);

        expect(result).toBe(true);
        const written = mocks.trackStore.set.mock.calls.at(-1)?.[0];
        if (!written) {
            throw new Error('expected trackStore.set');
        }
        const clips = written.tracks[0]!.clips;
        const byId = new Map(clips.map((clip) => [clip.id, clip]));

        // Left part survives with its original id, trimmed to the edge.
        expect(byId.get('left-crossing')?.endBeat).toBe(2);
        // The inside clip is gone (replaced by the bounce), its MIDI cleaned.
        expect(byId.has('fully-inside')).toBe(false);
        expect(midiMocks.state.value?.notesByClipId['fully-inside']).toBeUndefined();
        // The right part survives on a fresh id at the selection end.
        const rightParts = clips.filter((clip) => clip.startBeat === 8 && clip.id !== 'fully-inside');
        const keptRight = rightParts.find((clip) => clip.id.startsWith('clip-bsel-'));
        expect(keptRight?.endBeat).toBe(10);
        expect(keptRight?.midiOffsetBeats).toBe(0);
        // Bounced clip occupies the selection.
        expect(clips.some((clip) => clip.type === 'audio' && clip.startBeat === 2 && clip.endBeat === 8)).toBe(true);
        // Notes partitioned at media beats with in-selection notes discarded.
        expect(midiMocks.splitMidiNotesAtBeat).toHaveBeenCalledTimes(2);
        expect(midiMocks.splitMidiNotesAtBeat).toHaveBeenCalledWith(
            expect.objectContaining({ sourceClipId: 'right-crossing', splitBeat: 2, discardBeforeBeat: 2 })
        );
    });

    it('undo reinstates pre-bounce notes and redo reapplies the partition (regression: PR #621 review)', async () => {
        // A right-crossing MIDI clip [6,10) over selection [2,8): one note
        // inside the selection (media 0.5) and one outside (media 3).
        midiMocks.state.value = {
            notesByClipId: {
                'right-crossing': [
                    { id: 'n-in', pitch: 60, startBeat: 0.5, duration: 0.5, velocity: 100 },
                    { id: 'n-out', pitch: 64, startBeat: 3, duration: 0.5, velocity: 100 },
                ],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        };
        const rightCrossing = createAudioClip({ id: 'right-crossing', startBeat: 6, endBeat: 10, type: 'midi' });
        const track: Track = normalizeTrack({
            id: 'track-1',
            name: 'Track 1',
            kind: 'midi',
            muted: false,
            clips: [rightCrossing],
        } as unknown as Track);
        mocks.trackStore.value = { tracks: [track], selectedTrackId: 'track-1', ghostClips: [] };
        mocks.renderTrackOffline.mockResolvedValue(createTestAudioBuffer());

        const result = await bounceSelection('track-1', 2, 8);
        expect(result).toBe(true);

        // Post-bounce: the source entry is gone; the kept right part holds
        // the outside note re-based to media 1 on a fresh id.
        expect(midiMocks.state.value?.notesByClipId['right-crossing']).toBeUndefined();
        const postEntries = Object.entries(midiMocks.state.value?.notesByClipId ?? {});
        const [, keptNotes] = postEntries.find(([id]) => id.startsWith('clip-bsel-')) ?? [];
        expect(keptNotes).toMatchObject([{ id: 'n-out', startBeat: 1 }]);

        const undoCallback = mocks.pushUndoEntry.mock.calls[0]?.[1];
        const redoCallback = mocks.pushUndoEntry.mock.calls[0]?.[2];
        if (!undoCallback || !redoCallback) {
            throw new Error('expected an undo entry');
        }

        // Undo: both original notes return under the source id with their
        // identities intact; the generated right-part entry disappears.
        undoCallback();
        expect(midiMocks.state.value?.notesByClipId['right-crossing']).toEqual([
            { id: 'n-in', pitch: 60, startBeat: 0.5, duration: 0.5, velocity: 100 },
            { id: 'n-out', pitch: 64, startBeat: 3, duration: 0.5, velocity: 100 },
        ]);
        expect(Object.keys(midiMocks.state.value?.notesByClipId ?? {}).some((id) => id.startsWith('clip-bsel-'))).toBe(
            false
        );

        // Redo: the post-bounce partition returns exactly.
        redoCallback();
        expect(midiMocks.state.value?.notesByClipId['right-crossing']).toBeUndefined();
        const redoEntries = Object.entries(midiMocks.state.value?.notesByClipId ?? {});
        const [, redoNotes] = redoEntries.find(([id]) => id.startsWith('clip-bsel-')) ?? [];
        expect(redoNotes).toMatchObject([{ id: 'n-out', startBeat: 1 }]);
    });

    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        vi.setSystemTime(1234567890);
        vi.spyOn(crypto, 'randomUUID').mockReturnValue('11111111-1111-4111-8111-111111111111');

        mocks.trackStore.set.mockImplementation((state) => {
            mocks.trackStore.value = state;
        });
        mocks.cacheAudioBuffer.mockImplementation((input) => input.bufferId ?? 'generated-buffer-id');
        midiMocks.state.value = { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} };
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('should clip the selected range, cache the render, and preserve undo snapshots', async () => {
        const renderedBuffer = createTestAudioBuffer();
        const beforeClip = createAudioClip({ id: 'clip-before', startBeat: 0, endBeat: 1 });
        const selectedClip = createAudioClip({ id: 'clip-selected', startBeat: 2, endBeat: 6 });
        const afterClip = createAudioClip({ id: 'clip-after', startBeat: 9, endBeat: 10 });
        const sourceTrack = createAudioTrack({
            clips: [beforeClip, selectedClip, afterClip],
        });

        setTrackStoreState({ tracks: [sourceTrack], selectedTrackId: 'track-1' });
        mocks.renderTrackOffline.mockResolvedValue(renderedBuffer);

        const didWrite = await bounceSelection('track-1', 2, 6);

        const expectedBufferId = 'bounce-sel-track-1-1234567890';
        expect(mocks.renderTrackOffline).toHaveBeenCalledWith(
            expect.objectContaining({
                clips: [expect.objectContaining({ id: 'clip-selected', startBeat: 2, endBeat: 6 })],
            }),
            2,
            6
        );
        expect(mocks.cacheAudioBuffer).toHaveBeenCalledWith({ buffer: renderedBuffer, bufferId: expectedBufferId });

        const bouncedTrack = mocks.trackStore.value?.tracks[0];
        expect(bouncedTrack?.clips).toEqual([
            beforeClip,
            afterClip,
            expect.objectContaining({
                id: 'bounced-sel-11111111-1111-4111-8111-111111111111',
                trackId: 'track-1',
                name: 'Guitar (selection bounce)',
                startBeat: 2,
                endBeat: 6,
                audioBufferId: expectedBufferId,
            }),
        ]);

        const [label, undo, redo] = getFirstUndoEntry();
        expect(label).toBe('Bounce Selection');

        undo();
        expect(mocks.trackStore.value?.tracks).toEqual([sourceTrack]);

        redo();
        expect(mocks.trackStore.value?.tracks[0]?.clips).toEqual(bouncedTrack?.clips);
        expect(didWrite).toBe(true);
    });

    it('reports no-write when offline rendering rejects a dormant VCA selection', async () => {
        const sourceTrack = createAudioTrack();
        Object.defineProperty(sourceTrack, 'kind', { value: 'vca' });
        setTrackStoreState({ tracks: [sourceTrack], selectedTrackId: 'track-1' });
        mocks.renderTrackOffline.mockResolvedValue(null);

        const didWrite = await bounceSelection('track-1', 0, 4);

        expect(mocks.cacheAudioBuffer).not.toHaveBeenCalled();
        expect(crypto.randomUUID).not.toHaveBeenCalled();
        expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
        expect(mocks.trackStore.set).not.toHaveBeenCalled();
        expect(didWrite).toBe(false);
    });

    it('discards a completed render when the destination disappears while rendering', async () => {
        const renderedBuffer = createTestAudioBuffer();
        const sourceTrack = createAudioTrack();
        let finishRender = (_buffer: AudioBuffer | null): void => {
            throw new Error('Expected the render promise to be controlled by the test');
        };
        const pendingRender = new Promise<AudioBuffer | null>((resolve) => {
            finishRender = resolve;
        });
        setTrackStoreState({ tracks: [sourceTrack], selectedTrackId: 'track-1' });
        mocks.renderTrackOffline.mockReturnValue(pendingRender);

        const pendingBounce = bounceSelection('track-1', 0, 4);
        expect(mocks.renderTrackOffline).toHaveBeenCalledTimes(1);
        setTrackStoreState({ tracks: [], selectedTrackId: null });
        finishRender(renderedBuffer);

        const didWrite = await pendingBounce;

        expect(mocks.cacheAudioBuffer).not.toHaveBeenCalled();
        expect(crypto.randomUUID).not.toHaveBeenCalled();
        expect(mocks.trackStore.set).not.toHaveBeenCalled();
        expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
        expect(didWrite).toBe(false);
    });
});
