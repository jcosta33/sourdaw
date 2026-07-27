import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { midiStore } from '#/modules/MIDI/stores';
import { prepareMidiGlobalTimeTransaction } from '#/modules/MIDI/useCases';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { trackStore } from '../../../stores/trackStore';
import {
    setTimeOperationDependencies,
    type TimeOperationDependencies,
} from '../../timeOperations/timeOperationDependencies';
import { executeSelectedTimeRangeDeletion } from '../executeSelectedTimeRangeDeletion';

const EMPTY_MIDI_STATE = {
    notesByClipId: {},
    ccByClipId: {},
    pitchBendByClipId: {},
};

function noChangePreparation() {
    return {
        status: 'ready' as const,
        hasChanges: false,
        replayPlan: { version: 1 as const, notes: [] },
        inversePlan: null,
        apply: () => false,
        revert: () => false,
    };
}

function installRealMidiPreparation() {
    setTimeOperationDependencies({
        prepareAutomationTimeOperation: noChangePreparation,
        prepareAutomationTimeStateRestore: noChangePreparation,
        prepareMidiGlobalTimeTransaction,
        prepareMidiTimeStateRestore: noChangePreparation,
        prepareTimelineMapTimeOperation: noChangePreparation,
        prepareTimelineMapStateRestore: noChangePreparation,
    });
}

function createClip(input: {
    id: string;
    trackId: string;
    startBeat: number;
    endBeat: number;
    type?: 'audio' | 'midi';
}) {
    return ClipDummy.create({
        id: input.id,
        trackId: input.trackId,
        startBeat: input.startBeat,
        endBeat: input.endBeat,
        type: input.type ?? 'audio',
    });
}

function createTrack(
    id: string,
    clips: ReturnType<typeof createClip>[],
    kind: 'audio' | 'midi' | 'bus' | 'master' | 'folder' = 'audio'
) {
    return TrackDummy.create({ id, clips, kind });
}

function setArrangement(tracks: ReturnType<typeof createTrack>[]) {
    const state = {
        tracks,
        selectedTrackId: tracks[0]?.id ?? null,
        ghostClips: [],
    };
    trackStore.set(state);
    return state;
}

const REJECTED = { status: 'rejected', hasChanges: false, replayPlan: null, inversePlan: null };

describe('executeSelectedTimeRangeDeletion store validation', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        midiStore.set(EMPTY_MIDI_STATE);
        installRealMidiPreparation();
        vi.spyOn(crypto, 'randomUUID').mockReturnValue('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    });

    afterEach(() => {
        setTimeOperationDependencies(null);
        vi.restoreAllMocks();
    });

    it('rejects when track state is unavailable', () => {
        trackStore.clear();
        const result = executeSelectedTimeRangeDeletion({ startBeat: 0, endBeat: 4, trackIds: ['t1'] });
        expect(result).toMatchObject(REJECTED);
    });

    it('rejects when a target track id does not exist in the store', () => {
        setArrangement([createTrack('real', [createClip({ id: 'c1', trackId: 'real', startBeat: 0, endBeat: 2 })])]);
        const result = executeSelectedTimeRangeDeletion({ startBeat: 0, endBeat: 4, trackIds: ['missing'] });
        expect(result).toMatchObject(REJECTED);
    });

    it('rejects when a target track is dormant (does not accept clip updates)', () => {
        const dormant = createTrack('dormant', []);
        Reflect.set(dormant, 'kind', 'vca');
        setArrangement([dormant]);
        const result = executeSelectedTimeRangeDeletion({ startBeat: 0, endBeat: 4, trackIds: ['dormant'] });
        expect(result).toMatchObject(REJECTED);
    });

    it('rejects a clip missing required boolean fields (muted)', () => {
        const clip = createClip({ id: 'c1', trackId: 't1', startBeat: 0, endBeat: 10 });
        Reflect.set(clip, 'muted', 'yes');
        setArrangement([createTrack('t1', [clip])]);
        const result = executeSelectedTimeRangeDeletion({ startBeat: 2, endBeat: 6, trackIds: ['t1'] });
        expect(result).toMatchObject(REJECTED);
    });

    it('rejects a clip with a non-number gain', () => {
        const clip = createClip({ id: 'c1', trackId: 't1', startBeat: 0, endBeat: 10 });
        Reflect.set(clip, 'gain', 'loud');
        setArrangement([createTrack('t1', [clip])]);
        const result = executeSelectedTimeRangeDeletion({ startBeat: 2, endBeat: 6, trackIds: ['t1'] });
        expect(result).toMatchObject(REJECTED);
    });

    it('rejects a clip with an unknown type', () => {
        const clip = createClip({ id: 'c1', trackId: 't1', startBeat: 0, endBeat: 10 });
        Reflect.set(clip, 'type', 'video');
        setArrangement([createTrack('t1', [clip])]);
        const result = executeSelectedTimeRangeDeletion({ startBeat: 2, endBeat: 6, trackIds: ['t1'] });
        expect(result).toMatchObject(REJECTED);
    });

    it('rejects a clip with a non-finite audioOffsetBeats', () => {
        const clip = createClip({ id: 'c1', trackId: 't1', startBeat: 0, endBeat: 10, type: 'audio' });
        clip.audioOffsetBeats = Number.POSITIVE_INFINITY;
        setArrangement([createTrack('t1', [clip])]);
        const result = executeSelectedTimeRangeDeletion({ startBeat: 2, endBeat: 6, trackIds: ['t1'] });
        expect(result).toMatchObject(REJECTED);
    });

    it('rejects a clip with a non-finite midiOffsetBeats', () => {
        const clip = createClip({ id: 'c1', trackId: 't1', startBeat: 0, endBeat: 10, type: 'midi' });
        clip.midiOffsetBeats = Number.NaN;
        setArrangement([createTrack('t1', [clip])]);
        const result = executeSelectedTimeRangeDeletion({ startBeat: 2, endBeat: 6, trackIds: ['t1'] });
        expect(result).toMatchObject(REJECTED);
    });

    it('rejects a clip whose endBeat is below its startBeat', () => {
        const clip = createClip({ id: 'c1', trackId: 't1', startBeat: 5, endBeat: 2 });
        setArrangement([createTrack('t1', [clip])]);
        const result = executeSelectedTimeRangeDeletion({ startBeat: 0, endBeat: 4, trackIds: ['t1'] });
        expect(result).toMatchObject(REJECTED);
    });

    it('rejects a clip with an empty id', () => {
        const clip = createClip({ id: '   ', trackId: 't1', startBeat: 0, endBeat: 10 });
        setArrangement([createTrack('t1', [clip])]);
        const result = executeSelectedTimeRangeDeletion({ startBeat: 2, endBeat: 6, trackIds: ['t1'] });
        expect(result).toMatchObject(REJECTED);
    });
});

describe('executeSelectedTimeRangeDeletion track-shape validation', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        midiStore.set(EMPTY_MIDI_STATE);
        installRealMidiPreparation();
        vi.spyOn(crypto, 'randomUUID').mockReturnValue('12341234-1234-4234-8234-123456789abc');
    });

    afterEach(() => {
        setTimeOperationDependencies(null);
        vi.restoreAllMocks();
    });

    // Each case mutates one field on an otherwise-valid owner track so that validateTrack
    // must reject the store before any identity allocation or writes occur.
    function rejectsMalformedTrack(field: string, value: unknown): void {
        const clip = createClip({ id: 'c1', trackId: 't1', startBeat: 0, endBeat: 10 });
        const track = createTrack('t1', [clip]);
        Reflect.set(track, field, value);
        setArrangement([track]);
        const result = executeSelectedTimeRangeDeletion({ startBeat: 2, endBeat: 6, trackIds: ['t1'] });
        expect(result).toMatchObject(REJECTED);
    }

    it.each([
        ['name', 5],
        ['clips', 'nope'],
        ['kind', 'instrument'],
        ['muted', 'no'],
        ['soloed', 'no'],
        ['armed', 'no'],
        ['frozen', 'no'],
        ['collapsed', 'no'],
        ['hidden', 'no'],
        ['disabled', 'no'],
        ['soloSafe', 'no'],
        ['followChordTrack', 'no'],
        ['gain', 'loud'],
        ['pan', 'center'],
        ['height', 'tall'],
        ['color', 5],
        ['outputId', 5],
        ['notes', 5],
        ['activeAlternativeId', 5],
        ['devices', 'nope'],
        ['sends', 'nope'],
        ['midiFx', 'nope'],
        ['alternatives', 'nope'],
        ['parentId', 5],
        ['groupId', 5],
        ['inputId', 5],
        ['vcaGroupId', 5],
        ['midiOutputTrackId', 5],
        ['inputMonitoring', 'always'],
        ['automationMode', 'trim'],
        ['freezeState', 'nope'],
    ])('rejects a track with malformed %s', (field, value) => {
        rejectsMalformedTrack(field, value);
    });

    it('rejects a track with an empty id', () => {
        const clip = createClip({ id: 'c1', trackId: 't1', startBeat: 0, endBeat: 10 });
        const track = createTrack('t1', [clip]);
        Reflect.set(track, 'id', '   ');
        setArrangement([track]);
        const result = executeSelectedTimeRangeDeletion({ startBeat: 2, endBeat: 6, trackIds: ['t1'] });
        expect(result).toMatchObject(REJECTED);
    });
});

describe('executeSelectedTimeRangeDeletion computed-value validation', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        midiStore.set(EMPTY_MIDI_STATE);
        installRealMidiPreparation();
        vi.spyOn(crypto, 'randomUUID').mockReturnValue('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    });

    afterEach(() => {
        setTimeOperationDependencies(null);
        vi.restoreAllMocks();
    });

    it('rejects a right-edge-overlapping clip whose shifted audio offset would overflow', () => {
        const clip = createClip({
            id: 'c1',
            trackId: 't1',
            startBeat: 4,
            endBeat: Number.MAX_VALUE,
            type: 'audio',
        });
        clip.audioOffsetBeats = Number.MAX_VALUE;
        setArrangement([createTrack('t1', [clip])]);
        const result = executeSelectedTimeRangeDeletion({
            startBeat: 0,
            endBeat: Number.MAX_VALUE / 2,
            trackIds: ['t1'],
        });
        expect(result).toMatchObject(REJECTED);
    });

    it('rejects a fully-spanning midi clip whose split/discard beats would overflow', () => {
        const clip = createClip({
            id: 'c1',
            trackId: 't1',
            startBeat: 0,
            endBeat: Number.MAX_VALUE,
            type: 'midi',
        });
        clip.midiOffsetBeats = Number.MAX_VALUE;
        setArrangement([createTrack('t1', [clip])]);
        const result = executeSelectedTimeRangeDeletion({
            startBeat: 1,
            endBeat: Number.MAX_VALUE / 2,
            trackIds: ['t1'],
        });
        expect(result).toMatchObject(REJECTED);
    });
});

describe('executeSelectedTimeRangeDeletion supplied replay plan validation', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        midiStore.set(EMPTY_MIDI_STATE);
        installRealMidiPreparation();
        vi.spyOn(crypto, 'randomUUID').mockReturnValue('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
    });

    afterEach(() => {
        setTimeOperationDependencies(null);
        vi.restoreAllMocks();
    });

    it('rejects an empty-target-set supplied replay plan with the wrong version', () => {
        const result = executeSelectedTimeRangeDeletion({
            startBeat: 0,
            endBeat: 4,
            trackIds: [],
            replayPlan: {
                version: 2,
                operation: { type: 'delete-selected-time-range', startBeat: 0, endBeat: 4, trackIds: [] },
                clips: [],
                midi: { version: 1, notes: [] },
            } as never,
        });
        expect(result).toMatchObject(REJECTED);
    });

    it('rejects an empty-target-set supplied replay plan whose midi is not empty', () => {
        const result = executeSelectedTimeRangeDeletion({
            startBeat: 0,
            endBeat: 4,
            trackIds: [],
            replayPlan: {
                version: 1,
                operation: { type: 'delete-selected-time-range', startBeat: 0, endBeat: 4, trackIds: [] },
                clips: [],
                midi: { version: 1, notes: [{ id: 'n1' }] },
            } as never,
        });
        expect(result).toMatchObject(REJECTED);
    });

    it('rejects an empty-target-set supplied replay plan whose operation type differs', () => {
        const result = executeSelectedTimeRangeDeletion({
            startBeat: 0,
            endBeat: 4,
            trackIds: [],
            replayPlan: {
                version: 1,
                operation: { type: 'delete', startBeat: 0, endBeat: 4, trackIds: [] },
                clips: [],
                midi: { version: 1, notes: [] },
            } as never,
        });
        expect(result).toMatchObject(REJECTED);
    });

    it('rejects an empty-target-set supplied replay plan whose midi shape is wrong', () => {
        const result = executeSelectedTimeRangeDeletion({
            startBeat: 0,
            endBeat: 4,
            trackIds: [],
            replayPlan: {
                version: 1,
                operation: { type: 'delete-selected-time-range', startBeat: 0, endBeat: 4, trackIds: [] },
                clips: [],
                midi: { version: 1 },
            } as never,
        });
        expect(result).toMatchObject(REJECTED);
    });

    it('rejects a non-empty-target supplied replay plan that is not a plain object', () => {
        const span = createClip({ id: 'span', trackId: 't1', startBeat: 0, endBeat: 10 });
        setArrangement([createTrack('t1', [span])]);
        const result = executeSelectedTimeRangeDeletion({
            startBeat: 2,
            endBeat: 6,
            trackIds: ['t1'],
            replayPlan: [] as unknown as never,
        });
        expect(result).toMatchObject(REJECTED);
    });

    it('rejects a non-empty-target supplied replay plan whose operation does not match', () => {
        const span = createClip({ id: 'span', trackId: 't1', startBeat: 0, endBeat: 10 });
        setArrangement([createTrack('t1', [span])]);
        const result = executeSelectedTimeRangeDeletion({
            startBeat: 2,
            endBeat: 6,
            trackIds: ['t1'],
            replayPlan: {
                version: 1,
                operation: { type: 'delete-selected-time-range', startBeat: 2, endBeat: 7, trackIds: ['t1'] },
                clips: [],
                midi: { version: 1, notes: [] },
            } as never,
        });
        expect(result).toMatchObject(REJECTED);
    });

    it('rejects a non-empty-target supplied replay plan whose clips length mismatches requests', () => {
        const span = createClip({ id: 'span', trackId: 't1', startBeat: 0, endBeat: 10 });
        setArrangement([createTrack('t1', [span])]);
        const result = executeSelectedTimeRangeDeletion({
            startBeat: 2,
            endBeat: 6,
            trackIds: ['t1'],
            replayPlan: {
                version: 1,
                operation: { type: 'delete-selected-time-range', startBeat: 2, endBeat: 6, trackIds: ['t1'] },
                clips: [
                    { role: 'selected-delete-right', sourceTrackId: 't1', sourceClipId: 'span', targetClipId: 'a' },
                    { role: 'selected-delete-right', sourceTrackId: 't1', sourceClipId: 'span', targetClipId: 'b' },
                ],
                midi: { version: 1, notes: [] },
            } as never,
        });
        expect(result).toMatchObject(REJECTED);
    });

    it('rejects a non-empty-target supplied replay plan whose clip identity has wrong shape', () => {
        const span = createClip({ id: 'span', trackId: 't1', startBeat: 0, endBeat: 10 });
        setArrangement([createTrack('t1', [span])]);
        const result = executeSelectedTimeRangeDeletion({
            startBeat: 2,
            endBeat: 6,
            trackIds: ['t1'],
            replayPlan: {
                version: 1,
                operation: { type: 'delete-selected-time-range', startBeat: 2, endBeat: 6, trackIds: ['t1'] },
                clips: [{ role: 'selected-delete-right', sourceTrackId: 't1', sourceClipId: 'span', extra: true }],
                midi: { version: 1, notes: [] },
            } as never,
        });
        expect(result).toMatchObject(REJECTED);
    });

    it('rejects a non-empty-target supplied replay plan whose targetClipId already exists', () => {
        const span = createClip({ id: 'span', trackId: 't1', startBeat: 0, endBeat: 10 });
        setArrangement([createTrack('t1', [span])]);
        const result = executeSelectedTimeRangeDeletion({
            startBeat: 2,
            endBeat: 6,
            trackIds: ['t1'],
            replayPlan: {
                version: 1,
                operation: { type: 'delete-selected-time-range', startBeat: 2, endBeat: 6, trackIds: ['t1'] },
                clips: [
                    {
                        role: 'selected-delete-right',
                        sourceTrackId: 't1',
                        sourceClipId: 'span',
                        targetClipId: 'span',
                    },
                ],
                midi: { version: 1, notes: [] },
            } as never,
        });
        expect(result).toMatchObject(REJECTED);
    });
});

describe('executeSelectedTimeRangeDeletion midi preparation rejection', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        midiStore.set(EMPTY_MIDI_STATE);
        vi.spyOn(crypto, 'randomUUID').mockReturnValue('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
    });

    afterEach(() => {
        setTimeOperationDependencies(null);
        vi.restoreAllMocks();
    });

    it('rejects when midi preparation reports not-ready', () => {
        function rejectedMidi(): ReturnType<TimeOperationDependencies['prepareMidiGlobalTimeTransaction']> {
            return {
                status: 'rejected',
                hasChanges: false,
                replayPlan: { version: 1, notes: [] },
                inversePlan: null,
                apply: () => false,
                revert: () => false,
            };
        }
        setTimeOperationDependencies({
            prepareAutomationTimeOperation: noChangePreparation,
            prepareAutomationTimeStateRestore: noChangePreparation,
            prepareMidiGlobalTimeTransaction: rejectedMidi,
            prepareMidiTimeStateRestore: noChangePreparation,
            prepareTimelineMapTimeOperation: noChangePreparation,
            prepareTimelineMapStateRestore: noChangePreparation,
        });
        const clip = createClip({ id: 'span', trackId: 't1', startBeat: 0, endBeat: 10 });
        setArrangement([createTrack('t1', [clip])]);
        const result = executeSelectedTimeRangeDeletion({ startBeat: 2, endBeat: 6, trackIds: ['t1'] });
        expect(result).toMatchObject(REJECTED);
    });

    it('throws when dependencies are not registered', () => {
        setTimeOperationDependencies(null);
        const clip = createClip({ id: 'span', trackId: 't1', startBeat: 0, endBeat: 10 });
        setArrangement([createTrack('t1', [clip])]);
        expect(() => executeSelectedTimeRangeDeletion({ startBeat: 2, endBeat: 6, trackIds: ['t1'] })).toThrow(
            'Arrangement time operation dependencies are not registered'
        );
    });
});

describe('executeSelectedTimeRangeDeletion clip geometry applied paths', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        midiStore.set(EMPTY_MIDI_STATE);
        installRealMidiPreparation();
        vi.spyOn(crypto, 'randomUUID').mockReturnValue('eeeeeeee-eeee-4eee-8aaa-eeeeeeeeeeee');
    });

    afterEach(() => {
        setTimeOperationDependencies(null);
        vi.restoreAllMocks();
    });

    it('trims a left-straddling clip to the operation start without splitting', () => {
        const clip = createClip({ id: 'left', trackId: 't1', startBeat: 0, endBeat: 8, type: 'audio' });
        setArrangement([createTrack('t1', [clip])]);
        const result = executeSelectedTimeRangeDeletion({ startBeat: 4, endBeat: 8, trackIds: ['t1'] });
        expect(result.status).toBe('applied');
        const next = trackStore.value as { tracks: Array<{ clips: Array<Record<string, unknown>> }> };
        expect(next.tracks[0]!.clips).toHaveLength(1);
        expect(next.tracks[0]!.clips[0]).toMatchObject({ id: 'left', startBeat: 0, endBeat: 4 });
    });

    it('shifts the start of a right-straddling clip to the operation end', () => {
        const clip = createClip({
            id: 'right',
            trackId: 't1',
            startBeat: 4,
            endBeat: 12,
            type: 'audio',
        });
        clip.audioOffsetBeats = 2;
        setArrangement([createTrack('t1', [clip])]);
        const result = executeSelectedTimeRangeDeletion({ startBeat: 2, endBeat: 8, trackIds: ['t1'] });
        expect(result.status).toBe('applied');
        const next = trackStore.value as { tracks: Array<{ clips: Array<Record<string, unknown>> }> };
        expect(next.tracks[0]!.clips).toHaveLength(1);
        expect(next.tracks[0]!.clips[0]).toMatchObject({
            id: 'right',
            startBeat: 8,
            endBeat: 12,
            audioOffsetBeats: 2 + (8 - 4),
        });
    });

    it('removes a fully-contained clip', () => {
        const clip = createClip({ id: 'inside', trackId: 't1', startBeat: 3, endBeat: 5 });
        setArrangement([createTrack('t1', [clip])]);
        const result = executeSelectedTimeRangeDeletion({ startBeat: 2, endBeat: 6, trackIds: ['t1'] });
        expect(result.status).toBe('applied');
        const next = trackStore.value as { tracks: Array<{ clips: unknown[] }> };
        expect(next.tracks[0]!.clips).toHaveLength(0);
    });

    it('leaves an out-of-range clip untouched (returns applied when other clips changed)', () => {
        const untouched = createClip({ id: 'outside', trackId: 't1', startBeat: 10, endBeat: 12 });
        const inside = createClip({ id: 'inside', trackId: 't1', startBeat: 3, endBeat: 5 });
        setArrangement([createTrack('t1', [untouched, inside])]);
        const result = executeSelectedTimeRangeDeletion({ startBeat: 2, endBeat: 6, trackIds: ['t1'] });
        expect(result.status).toBe('applied');
        const next = trackStore.value as { tracks: Array<{ clips: Array<{ id: string }> }> };
        expect(next.tracks[0]!.clips.map((c) => c.id)).toEqual(['outside']);
    });

    it('splits a fully-spanning midi clip into L/R fragments and records the midi split', () => {
        const clip = createClip({ id: 'span', trackId: 't1', startBeat: 0, endBeat: 10, type: 'midi' });
        clip.midiOffsetBeats = 1;
        setArrangement([createTrack('t1', [clip])]);
        const result = executeSelectedTimeRangeDeletion({ startBeat: 2, endBeat: 6, trackIds: ['t1'] });
        expect(result.status).toBe('applied');
        const next = trackStore.value as { tracks: Array<{ clips: Array<Record<string, unknown>> }> };
        expect(next.tracks[0]!.clips).toHaveLength(2);
        expect(next.tracks[0]!.clips[0]).toMatchObject({
            id: 'span',
            startBeat: 0,
            endBeat: 2,
            name: 'Test Clip (L)',
        });
        expect(next.tracks[0]!.clips[1]).toMatchObject({
            id: 'clip-dtr-eeeeeeee',
            startBeat: 6,
            endBeat: 10,
            name: 'Test Clip (R)',
            midiOffsetBeats: 0,
        });
    });

    it('returns no-change when no target clips are affected and no prepared handle has changes', () => {
        const untouched = createClip({ id: 'outside', trackId: 't1', startBeat: 10, endBeat: 12 });
        setArrangement([createTrack('t1', [untouched])]);
        const result = executeSelectedTimeRangeDeletion({ startBeat: 2, endBeat: 6, trackIds: ['t1'] });
        expect(result.status).toBe('no-change');
        const next = trackStore.value as { tracks: Array<{ clips: Array<{ id: string }> }> };
        expect(next.tracks[0]!.clips.map((c) => c.id)).toEqual(['outside']);
    });
});

describe('executeSelectedTimeRangeDeletion undo', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        midiStore.set(EMPTY_MIDI_STATE);
        installRealMidiPreparation();
        vi.spyOn(crypto, 'randomUUID').mockReturnValue('ffffffff-ffff-4fff-8fff-ffffffffffff');
    });

    afterEach(() => {
        setTimeOperationDependencies(null);
        vi.restoreAllMocks();
    });

    it('restores the captured arrangement state after undoing an applied deletion', () => {
        const clip = createClip({ id: 'inside', trackId: 't1', startBeat: 3, endBeat: 5 });
        setArrangement([createTrack('t1', [clip])]);
        const captured = trackStore.value;
        const result = executeSelectedTimeRangeDeletion({ startBeat: 2, endBeat: 6, trackIds: ['t1'] });
        expect(result.status).toBe('applied');
        if (result.status !== 'applied') {
            throw new Error('Expected applied');
        }
        // Sanity: the deletion mutated the store.
        expect(trackStore.value).not.toBe(captured);

        const undone = result.undo();
        expect(undone).toBe(true);
        expect(trackStore.value).toBe(captured);
    });
});
