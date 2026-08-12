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
        resolveEligibleClipWriteTarget: vi.fn((): { status: string; trackId?: string } => ({
            status: 'eligible',
            trackId: 'track-1',
        })),
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

vi.mock('../../../stores/resolveEligibleClipWriteTarget', () => ({
    resolveEligibleClipWriteTarget: mocks.resolveEligibleClipWriteTarget,
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

    it('captures and restores control-change and pitch-bend snapshots alongside notes', async () => {
        // The midi snapshot must freeze cc/pitch-bend when present (truthy
        // branches in captureMidiClipData), and undo must reinstate them.
        midiMocks.state.value = {
            notesByClipId: {
                'right-crossing': [{ id: 'n-in', pitch: 60, startBeat: 0.5, duration: 0.5, velocity: 100 }],
            },
            ccByClipId: { 'right-crossing': [{ id: 'cc-1', controller: 1, value: 64, beat: 0, channel: 0 }] },
            pitchBendByClipId: { 'right-crossing': [{ id: 'pb-1', value: 128, beat: 0, channel: 0 }] },
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

        // Undo reinstates the frozen cc and pitch-bend alongside the notes.
        const undoCallback = mocks.pushUndoEntry.mock.calls[0]?.[1];
        if (!undoCallback) {
            throw new Error('expected an undo entry');
        }
        undoCallback();

        expect(midiMocks.state.value?.ccByClipId['right-crossing']).toEqual([
            { id: 'cc-1', controller: 1, value: 64, beat: 0, channel: 0 },
        ]);
        expect(midiMocks.state.value?.pitchBendByClipId['right-crossing']).toEqual([
            { id: 'pb-1', value: 128, beat: 0, channel: 0 },
        ]);
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
                clips: [beforeClip, selectedClip, afterClip],
            }),
            2,
            6,
            // The selection bounce now watches what the render scheduled, so it
            // can refuse to delete the MIDI in exchange for a silent clip.
            { onScheduled: expect.any(Function) }
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

    it('reports no-write when the track store has not loaded', async () => {
        mocks.trackStore.value = null;

        const didWrite = await bounceSelection('track-1', 0, 4);

        expect(mocks.renderTrackOffline).not.toHaveBeenCalled();
        expect(didWrite).toBe(false);
    });

    it('reports no-write when the target track does not exist', async () => {
        setTrackStoreState({ tracks: [], selectedTrackId: null });

        const didWrite = await bounceSelection('missing-track', 0, 4);

        expect(mocks.renderTrackOffline).not.toHaveBeenCalled();
        expect(didWrite).toBe(false);
    });

    it('reports no-write when no clips fall inside the selection range', async () => {
        // Clip sits entirely outside [2,6) → clipsInRange is empty.
        const outsideClip = createAudioClip({ id: 'clip-outside', startBeat: 8, endBeat: 12 });
        const sourceTrack = createAudioTrack({ clips: [outsideClip] });
        setTrackStoreState({ tracks: [sourceTrack], selectedTrackId: 'track-1' });

        const didWrite = await bounceSelection('track-1', 2, 6);

        expect(mocks.renderTrackOffline).not.toHaveBeenCalled();
        expect(didWrite).toBe(false);
    });

    it('reports no-write when the offline render returns no buffer', async () => {
        const selectedClip = createAudioClip({ id: 'clip-selected', startBeat: 2, endBeat: 6 });
        const sourceTrack = createAudioTrack({ clips: [selectedClip] });
        setTrackStoreState({ tracks: [sourceTrack], selectedTrackId: 'track-1' });
        mocks.renderTrackOffline.mockResolvedValue(null);

        const didWrite = await bounceSelection('track-1', 2, 6);

        expect(mocks.cacheAudioBuffer).not.toHaveBeenCalled();
        expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
        expect(didWrite).toBe(false);
    });

    it('keeps both outside parts when a clip spans the entire selection', async () => {
        // A single clip [0,10) over selection [2,8): kept as a left part [0,2)
        // and a right part [8,10), with the bounce filling [2,8).
        const spanningClip = createAudioClip({ id: 'clip-span', startBeat: 0, endBeat: 10 });
        const sourceTrack = createAudioTrack({ clips: [spanningClip] });
        setTrackStoreState({ tracks: [sourceTrack], selectedTrackId: 'track-1' });
        mocks.renderTrackOffline.mockResolvedValue(createTestAudioBuffer());

        const didWrite = await bounceSelection('track-1', 2, 8);

        expect(didWrite).toBe(true);
        const written = mocks.trackStore.set.mock.calls.at(-1)?.[0];
        if (!written) {
            throw new Error('expected trackStore.set');
        }
        const clips = written.tracks[0]!.clips;
        // left part keeps the original id, trimmed to the left edge
        const left = clips.find((c) => c.id === 'clip-span');
        expect(left?.startBeat).toBe(0);
        expect(left?.endBeat).toBe(2);
        // right part on a fresh id at the selection end
        const right = clips.find((c) => c.id.startsWith('clip-bsel-') && c.startBeat === 8);
        expect(right?.endBeat).toBe(10);
        // bounce fills the selection
        expect(clips.some((c) => c.type === 'audio' && c.startBeat === 2 && c.endBeat === 8)).toBe(true);
    });

    it('partitions MIDI notes when a midi clip spans the entire selection', async () => {
        // A midi clip [0,10) over selection [2,8): the spanning branch must
        // register a split op so the in-selection notes move to the right part.
        midiMocks.state.value = {
            notesByClipId: {
                'clip-span-midi': [
                    { id: 'n-in', pitch: 60, startBeat: 5, duration: 0.5, velocity: 100 },
                    { id: 'n-out', pitch: 64, startBeat: 9, duration: 0.5, velocity: 100 },
                ],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        };
        const spanningMidi = createAudioClip({ id: 'clip-span-midi', startBeat: 0, endBeat: 10, type: 'midi' });
        const track = normalizeTrack({
            id: 'track-1',
            name: 'Midi',
            kind: 'midi',
            clips: [spanningMidi],
        } as unknown as Track);
        setTrackStoreState({ tracks: [track], selectedTrackId: 'track-1' });
        mocks.renderTrackOffline.mockResolvedValue(createTestAudioBuffer());

        await bounceSelection('track-1', 2, 8);

        // The spanning midi clip triggers exactly one split op for the right part.
        expect(midiMocks.splitMidiNotesAtBeat).toHaveBeenCalledTimes(1);
        const splitCall = midiMocks.splitMidiNotesAtBeat.mock.calls[0]?.[0];
        expect(splitCall?.sourceClipId).toBe('clip-span-midi');
        expect(splitCall?.newClipId.startsWith('clip-bsel-')).toBe(true);
    });

    it('reports no-write when the track store is torn down after a successful render', async () => {
        const selectedClip = createAudioClip({ id: 'clip-selected', startBeat: 2, endBeat: 6 });
        const sourceTrack = createAudioTrack({ clips: [selectedClip] });
        let finishRender = (_buffer: AudioBuffer | null): void => {
            throw new Error('Expected the render promise to be controlled by the test');
        };
        const pendingRender = new Promise<AudioBuffer | null>((resolve) => {
            finishRender = resolve;
        });
        setTrackStoreState({ tracks: [sourceTrack], selectedTrackId: 'track-1' });
        mocks.renderTrackOffline.mockReturnValue(pendingRender);

        const pendingBounce = bounceSelection('track-1', 2, 6);
        // Store torn down while the render is in flight (freshState null path).
        mocks.trackStore.value = null;
        finishRender(createTestAudioBuffer());

        const didWrite = await pendingBounce;

        expect(mocks.cacheAudioBuffer).not.toHaveBeenCalled();
        expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
        expect(didWrite).toBe(false);
    });

    it('reports no-write when the destination track index cannot be resolved after render', async () => {
        const selectedClip = createAudioClip({ id: 'clip-selected', startBeat: 2, endBeat: 6 });
        const sourceTrack = createAudioTrack({ clips: [selectedClip] });
        let finishRender = (_buffer: AudioBuffer | null): void => {
            throw new Error('Expected the render promise to be controlled by the test');
        };
        const pendingRender = new Promise<AudioBuffer | null>((resolve) => {
            finishRender = resolve;
        });
        setTrackStoreState({ tracks: [sourceTrack], selectedTrackId: 'track-1' });
        mocks.renderTrackOffline.mockReturnValue(pendingRender);

        const pendingBounce = bounceSelection('track-1', 2, 6);
        // The eligible target resolves to track-1, but the track vanishes from
        // the store during the render → findIndex returns -1.
        setTrackStoreState({ tracks: [], selectedTrackId: null });
        finishRender(createTestAudioBuffer());

        const didWrite = await pendingBounce;

        expect(mocks.cacheAudioBuffer).not.toHaveBeenCalled();
        expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
        expect(didWrite).toBe(false);
    });

    it('discards a completed render when the clip-write target is no longer eligible', async () => {
        const selectedClip = createAudioClip({ id: 'clip-selected', startBeat: 2, endBeat: 6 });
        const sourceTrack = createAudioTrack({ clips: [selectedClip] });
        setTrackStoreState({ tracks: [sourceTrack], selectedTrackId: 'track-1' });
        mocks.renderTrackOffline.mockResolvedValue(createTestAudioBuffer());
        mocks.resolveEligibleClipWriteTarget.mockReturnValueOnce({ status: 'ineligible' });

        const didWrite = await bounceSelection('track-1', 2, 6);

        expect(mocks.cacheAudioBuffer).not.toHaveBeenCalled();
        expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
        expect(didWrite).toBe(false);
    });

    it('trims an audio clip crossing the left edge without producing a midi discard id', async () => {
        const leftCrossing = createAudioClip({
            id: 'left-audio',
            startBeat: 0,
            endBeat: 6,
            type: 'audio',
            audioOffsetBeats: 1,
        });
        const inside = createAudioClip({ id: 'inside', startBeat: 3, endBeat: 5, type: 'audio' });
        const track: Track = normalizeTrack({
            id: 'track-1',
            name: 'Track 1',
            kind: 'audio',
            muted: false,
            clips: [leftCrossing, inside],
        } as unknown as Track);
        setTrackStoreState({ tracks: [track], selectedTrackId: 'track-1' });
        mocks.renderTrackOffline.mockResolvedValue(createTestAudioBuffer());

        const result = await bounceSelection('track-1', 2, 6);

        expect(result).toBe(true);
        const written = mocks.trackStore.set.mock.calls.at(-1)?.[0];
        const clips = written!.tracks[0]!.clips;
        // Audio left-edge clip is trimmed, no split/discard id generated.
        expect(clips.find((clip) => clip.id === 'left-audio')).toMatchObject({ startBeat: 0, endBeat: 2 });
        expect(clips.find((clip) => clip.id.startsWith('clip-bsel-discard'))).toBeUndefined();
        expect(midiMocks.splitMidiNotesAtBeat).not.toHaveBeenCalled();
    });

    it('keeps the right part of an audio clip crossing the right edge without midi partitioning', async () => {
        const rightCrossing = createAudioClip({
            id: 'right-audio',
            startBeat: 4,
            endBeat: 10,
            type: 'audio',
            audioOffsetBeats: 2,
        });
        const inside = createAudioClip({ id: 'inside', startBeat: 2, endBeat: 4, type: 'audio' });
        const track: Track = normalizeTrack({
            id: 'track-1',
            name: 'Track 1',
            kind: 'audio',
            muted: false,
            clips: [inside, rightCrossing],
        } as unknown as Track);
        setTrackStoreState({ tracks: [track], selectedTrackId: 'track-1' });
        mocks.renderTrackOffline.mockResolvedValue(createTestAudioBuffer());

        const result = await bounceSelection('track-1', 2, 6);

        expect(result).toBe(true);
        const written = mocks.trackStore.set.mock.calls.at(-1)?.[0];
        const clips = written!.tracks[0]!.clips;
        // Right part kept on a fresh id at the selection end, audio offset rebased.
        const keptRight = clips.find((clip) => clip.id.startsWith('clip-bsel-'));
        expect(keptRight).toMatchObject({ startBeat: 6, endBeat: 10, midiOffsetBeats: 0 });
        expect(keptRight?.audioOffsetBeats).toBe(2 + (6 - 4));
        expect(midiMocks.splitMidiNotesAtBeat).not.toHaveBeenCalled();
    });

    it('undo and redo are no-ops on the project tracks when the store is cleared first', async () => {
        const selectedClip = createAudioClip({ id: 'clip-selected', startBeat: 2, endBeat: 6 });
        const sourceTrack = createAudioTrack({ clips: [selectedClip] });
        setTrackStoreState({ tracks: [sourceTrack], selectedTrackId: 'track-1' });
        mocks.renderTrackOffline.mockResolvedValue(createTestAudioBuffer());

        await bounceSelection('track-1', 2, 6);

        const [, undo, redo] = getFirstUndoEntry();
        // Tear the store down so both undo and redo guards short-circuit on the tracks write.
        mocks.trackStore.value = null;
        expect(() => undo()).not.toThrow();
        expect(() => redo()).not.toThrow();
        expect(mocks.trackStore.value).toBeNull();
    });
});
