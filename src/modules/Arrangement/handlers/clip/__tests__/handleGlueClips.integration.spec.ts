import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { automationStore } from '#/modules/Automation/stores';
import { clearHandlerRegistry, macroStore, registerHandlerMap } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    executeAppActionBatch,
    getMacroHandlers,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { defaultStepRecordState, midiStore, stepRecordStore } from '#/modules/MIDI/stores';
import { type AppAction, type ClipGlueActionSnapshot } from '#/utils/handlerContract';
import { setNotificationEventBus } from '#/utils/Notification/notificationEventBus';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { takeLaneStore } from '../../../stores/takeLaneStore';
import { trackStore } from '../../../stores/trackStore';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';
import { handleGlueClips } from '../handleGlueClips';

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

const LEGACY_GLUE_MACRO_ID = 'legacy-glue-macro';

function withProbability(snapshot: ClipGlueActionSnapshot, probability: number): ClipGlueActionSnapshot {
    return {
        ...snapshot,
        midi: {
            ...snapshot.midi,
            clips: snapshot.midi.clips.map((clip) => ({
                ...clip,
                data: {
                    ...clip.data,
                    notes: {
                        ...clip.data.notes,
                        value: clip.data.notes.value.map((note) => ({ ...note, probability })),
                    },
                },
            })),
        },
    };
}

function persistLegacyGlueMacro(probability?: number): Extract<AppAction, { type: 'glueClips' }> {
    const action: Extract<AppAction, { type: 'glueClips' }> = {
        type: 'glueClips',
        payload: { clipIds: ['clip-a', 'clip-b'] },
    };
    const description = handleGlueClips.describe(action);
    if (!description.inverseAction || !action.payload.expected || !action.payload.replacement) {
        throw new Error('Expected legacy glue snapshots');
    }
    if (probability !== undefined) {
        action.payload.expected = withProbability(action.payload.expected, probability);
        action.payload.replacement = withProbability(action.payload.replacement, probability);
    }
    const persistedAction = structuredClone(action);
    macroStore.set({
        macros: [
            {
                id: LEGACY_GLUE_MACRO_ID,
                name: 'Legacy glue',
                actions: [persistedAction],
                createdAt: 1,
            },
        ],
        recording: false,
        currentRecording: [],
    });
    return persistedAction;
}

describe('handleGlueClips atomic integration', () => {
    beforeEach(() => {
        setNotificationEventBus({ emit: () => Promise.resolve(), on: () => () => undefined });
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('glue clips atomic integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getMacroHandlers());
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        const first = ClipDummy.create({
            id: 'clip-a',
            trackId: 'track-midi',
            name: 'Intro A',
            type: 'midi',
            startBeat: 8,
            endBeat: 12,
            midiOffsetBeats: 2,
        });
        const second = ClipDummy.create({
            id: 'clip-b',
            trackId: 'track-midi',
            name: 'Intro B',
            type: 'midi',
            startBeat: 12,
            endBeat: 16,
            midiOffsetBeats: 1,
        });
        const track = TrackDummy.create({ id: 'track-midi', kind: 'midi', clips: [first, second] });
        trackStore.set({ tracks: [track], selectedTrackId: track.id, ghostClips: [] });
        midiStore.set({
            notesByClipId: {
                'clip-a': [{ id: 'note-a', pitch: 60, startBeat: 3, duration: 1, velocity: 100 }],
                'clip-b': [{ id: 'note-b', pitch: 64, startBeat: 2, duration: 1, velocity: 100 }],
            },
            ccByClipId: {
                'clip-a': [{ id: 'cc-a', controller: 1, value: 0.25, beat: 3, channel: 0 }],
            },
            pitchBendByClipId: {
                'clip-b': [{ id: 'bend-b', value: 0.25, beat: 3, channel: 0 }],
            },
            migratedAbsoluteNoteClipIds: ['clip-a', 'clip-b'],
        });
        automationStore.set({ lanes: [] });
        takeLaneStore.set({ lanes: [] });
        stepRecordStore.set(null);
    });

    afterEach(() => {
        setNotificationEventBus({ emit: () => Promise.resolve(), on: () => () => undefined });
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        midiStore.set({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        automationStore.set({ lanes: [] });
        takeLaneStore.set({ lanes: [] });
        stepRecordStore.set(null);
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('round-trips clips, MIDI rows, migration ownership, and target identity through undo and redo', async () => {
        const originalClips = structuredClone(trackStore.value!.tracks[0]!.clips);
        const originalMidi = structuredClone(midiStore.value!);

        const result = await executeAppActionBatch(
            [{ type: 'glueClips', payload: { clipIds: ['clip-a', 'clip-b'] } }],
            { source: 'prompt', requireCompensation: true }
        );

        expect(result).toMatchObject({ status: 'committed' });
        const glued = trackStore.value!.tracks[0]!.clips[0]!;
        expect(glued).toMatchObject({ name: 'Intro A (glued)', startBeat: 8, endBeat: 16, type: 'midi' });
        expect(midiStore.value!.notesByClipId[glued.id]).toMatchObject([
            { id: 'note-a', startBeat: 1 },
            { id: 'note-b', startBeat: 5 },
        ]);
        expect(midiStore.value!.ccByClipId[glued.id]).toMatchObject([{ id: 'cc-a', beat: 1 }]);
        expect(midiStore.value!.pitchBendByClipId[glued.id]).toMatchObject([{ id: 'bend-b', beat: 6 }]);
        expect(midiStore.value!.migratedAbsoluteNoteClipIds).toEqual([glued.id]);

        await undo();
        expect(trackStore.value!.tracks[0]!.clips).toEqual(originalClips);
        expect(midiStore.value).toEqual(originalMidi);

        await redo();
        expect(trackStore.value!.tracks[0]!.clips).toMatchObject([{ id: glued.id, name: 'Intro A (glued)' }]);
        expect(midiStore.value!.notesByClipId[glued.id]).toMatchObject([
            { id: 'note-a', startBeat: 1 },
            { id: 'note-b', startBeat: 5 },
        ]);
        expect(midiStore.value!.migratedAbsoluteNoteClipIds).toEqual([glued.id]);
    });

    it('re-preflights a legacy macro instead of replaying stale snapshots over probabilistic notes', async () => {
        const persistedAction = persistLegacyGlueMacro(50);
        midiStore.set({
            ...midiStore.value!,
            notesByClipId: Object.fromEntries(
                Object.entries(midiStore.value!.notesByClipId).map(([clipId, notes]) => [
                    clipId,
                    notes.map((note) => ({ ...note, probability: 50 })),
                ])
            ),
        });
        const originalTracks = structuredClone(trackStore.value!.tracks);
        const originalMidi = structuredClone(midiStore.value);

        await executeAppAction({ type: 'playMacro', payload: { macroId: LEGACY_GLUE_MACRO_ID } });

        expect(trackStore.value!.tracks).toEqual(originalTracks);
        expect(midiStore.value).toEqual(originalMidi);
        expect(macroStore.value?.macros[0]?.actions).toEqual([persistedAction]);
    });

    it('re-preflights a legacy macro instead of bypassing duplicate migration markers', async () => {
        const persistedAction = persistLegacyGlueMacro();
        midiStore.set({
            ...midiStore.value!,
            migratedAbsoluteNoteClipIds: ['clip-a', 'clip-b', 'unrelated', 'unrelated'],
        });
        const originalTracks = structuredClone(trackStore.value!.tracks);
        const originalMidi = structuredClone(midiStore.value);

        await executeAppAction({ type: 'playMacro', payload: { macroId: LEGACY_GLUE_MACRO_ID } });

        expect(trackStore.value!.tracks).toEqual(originalTracks);
        expect(midiStore.value).toEqual(originalMidi);
        expect(macroStore.value?.macros[0]?.actions).toEqual([persistedAction]);
    });

    it('re-preflights a safe legacy macro and keeps its replay undoable and redoable', async () => {
        const persistedAction = persistLegacyGlueMacro();

        await executeAppAction({ type: 'playMacro', payload: { macroId: LEGACY_GLUE_MACRO_ID } });

        const glued = trackStore.value!.tracks[0]!.clips[0]!;
        expect(trackStore.value!.tracks[0]!.clips).toMatchObject([{ id: glued.id, name: 'Intro A (glued)' }]);
        expect(macroStore.value?.macros[0]?.actions).toEqual([persistedAction]);

        await undo();
        expect(trackStore.value!.tracks[0]!.clips).toMatchObject([{ id: 'clip-a' }, { id: 'clip-b' }]);

        await redo();
        expect(trackStore.value!.tracks[0]!.clips).toMatchObject([{ id: glued.id, name: 'Intro A (glued)' }]);
    });

    it('refuses glue when a source note probability depends on the source clip identity', async () => {
        midiStore.set({
            ...midiStore.value!,
            notesByClipId: {
                ...midiStore.value!.notesByClipId,
                'clip-a': [
                    {
                        ...midiStore.value!.notesByClipId['clip-a']![0]!,
                        probability: 50,
                    },
                ],
            },
        });
        const originalTracks = structuredClone(trackStore.value!.tracks);
        const originalMidi = structuredClone(midiStore.value);

        await executeAppActionBatch([{ type: 'glueClips', payload: { clipIds: ['clip-a', 'clip-b'] } }], {
            source: 'prompt',
            requireCompensation: true,
        });

        expect(trackStore.value!.tracks).toEqual(originalTracks);
        expect(midiStore.value).toEqual(originalMidi);
    });

    it('refuses glue when migration markers contain duplicates', async () => {
        midiStore.set({
            ...midiStore.value!,
            migratedAbsoluteNoteClipIds: ['clip-a', 'clip-a', 'clip-b'],
        });
        const originalTracks = structuredClone(trackStore.value!.tracks);
        const originalMidi = structuredClone(midiStore.value);

        await executeAppActionBatch([{ type: 'glueClips', payload: { clipIds: ['clip-a', 'clip-b'] } }], {
            source: 'prompt',
            requireCompensation: true,
        });

        expect(trackStore.value!.tracks).toEqual(originalTracks);
        expect(midiStore.value).toEqual(originalMidi);
    });

    it('round-trips Unicode equal-time order exactly and redoes in code-unit order', async () => {
        midiStore.set({
            ...midiStore.value!,
            notesByClipId: {
                'clip-a': [
                    { id: 'é-note', pitch: 60, startBeat: 3, duration: 1, velocity: 100 },
                    { id: 'z-note', pitch: 62, startBeat: 3, duration: 1, velocity: 100 },
                ],
                'clip-b': [],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        const originalMidi = structuredClone(midiStore.value);

        await executeAppActionBatch([{ type: 'glueClips', payload: { clipIds: ['clip-a', 'clip-b'] } }], {
            source: 'prompt',
            requireCompensation: true,
        });
        const glued = trackStore.value!.tracks[0]!.clips[0]!;

        expect(midiStore.value!.notesByClipId[glued.id]?.map((note) => note.id)).toEqual(['z-note', 'é-note']);

        await undo();
        expect(midiStore.value).toEqual(originalMidi);

        await redo();
        expect(midiStore.value!.notesByClipId[glued.id]?.map((note) => note.id)).toEqual(['z-note', 'é-note']);
    });

    it('keeps the glue and undo entry when the target gains clip automation', async () => {
        await executeAppActionBatch([{ type: 'glueClips', payload: { clipIds: ['clip-a', 'clip-b'] } }], {
            source: 'prompt',
            requireCompensation: true,
        });
        const glued = trackStore.value!.tracks[0]!.clips[0]!;
        automationStore.set({
            lanes: [
                {
                    id: 'lane-glued-gain',
                    trackId: 'track-midi',
                    clipId: glued.id,
                    parameterId: 'gain',
                    parameterName: 'Gain',
                    points: [{ id: 'point-a', beat: 9, value: 0.5, curve: 'linear', tension: 0.5 }],
                    objects: [],
                    visible: true,
                    enabled: true,
                    collapsed: false,
                    minValue: 0,
                    maxValue: 1,
                },
            ],
        });

        await undo();

        expect(trackStore.value!.tracks[0]!.clips).toMatchObject([{ id: glued.id }]);
        expect(automationStore.value!.lanes).toMatchObject([{ clipId: glued.id }]);

        automationStore.set({ lanes: [] });
        await undo();
        expect(trackStore.value!.tracks[0]!.clips).toMatchObject([{ id: 'clip-a' }, { id: 'clip-b' }]);
    });

    it('keeps the glue and undo entry when a ghost clip links to the target', async () => {
        await executeAppActionBatch([{ type: 'glueClips', payload: { clipIds: ['clip-a', 'clip-b'] } }], {
            source: 'prompt',
            requireCompensation: true,
        });
        const glued = trackStore.value!.tracks[0]!.clips[0]!;
        const ghost = ClipDummy.create({
            id: 'clip-ghost',
            trackId: 'track-midi',
            type: 'midi',
            parentClipId: glued.id,
            isGhost: true,
        });
        trackStore.set({ ...trackStore.value!, ghostClips: [ghost] });

        await undo();

        expect(trackStore.value!.tracks[0]!.clips).toMatchObject([{ id: glued.id }]);
        expect(trackStore.value!.ghostClips).toMatchObject([{ id: 'clip-ghost', parentClipId: glued.id }]);

        trackStore.set({ ...trackStore.value!, ghostClips: [] });
        await undo();
        expect(trackStore.value!.tracks[0]!.clips).toMatchObject([{ id: 'clip-a' }, { id: 'clip-b' }]);
    });

    it('keeps the glue and undo entry when a hidden alternative duplicates a source id', async () => {
        await executeAppActionBatch([{ type: 'glueClips', payload: { clipIds: ['clip-a', 'clip-b'] } }], {
            source: 'prompt',
            requireCompensation: true,
        });
        const glued = trackStore.value!.tracks[0]!.clips[0]!;
        const duplicateSource = ClipDummy.create({
            id: 'clip-a',
            trackId: 'track-midi',
            type: 'midi',
            startBeat: 20,
            endBeat: 24,
        });
        trackStore.set({
            ...trackStore.value!,
            tracks: trackStore.value!.tracks.map((track) =>
                track.id === 'track-midi'
                    ? {
                          ...track,
                          alternatives: track.alternatives.map((alternative, index) =>
                              index === 0 ? { ...alternative, clips: [duplicateSource] } : alternative
                          ),
                      }
                    : track
            ),
        });

        await undo();

        expect(trackStore.value!.tracks[0]!.clips).toMatchObject([{ id: glued.id }]);
        expect(trackStore.value!.tracks[0]!.alternatives[0]!.clips).toMatchObject([{ id: 'clip-a' }]);

        trackStore.set({
            ...trackStore.value!,
            tracks: trackStore.value!.tracks.map((track) =>
                track.id === 'track-midi'
                    ? {
                          ...track,
                          alternatives: track.alternatives.map((alternative, index) =>
                              index === 0 ? { ...alternative, clips: [] } : alternative
                          ),
                      }
                    : track
            ),
        });
        await undo();
        expect(trackStore.value!.tracks[0]!.clips).toMatchObject([{ id: 'clip-a' }, { id: 'clip-b' }]);
    });

    it('keeps undo and redo retryable while step recording targets an affected clip', async () => {
        await executeAppActionBatch([{ type: 'glueClips', payload: { clipIds: ['clip-a', 'clip-b'] } }], {
            source: 'prompt',
            requireCompensation: true,
        });
        const glued = trackStore.value!.tracks[0]!.clips[0]!;
        stepRecordStore.set({
            ...defaultStepRecordState,
            active: true,
            clipId: 'clip-a',
            activeNotes: new Set<number>(),
        });

        await undo();

        expect(trackStore.value!.tracks[0]!.clips).toMatchObject([{ id: glued.id }]);
        stepRecordStore.set(null);
        await undo();
        expect(trackStore.value!.tracks[0]!.clips).toMatchObject([{ id: 'clip-a' }, { id: 'clip-b' }]);

        stepRecordStore.set({
            ...defaultStepRecordState,
            active: true,
            clipId: glued.id,
            activeNotes: new Set<number>(),
        });
        await redo();

        expect(trackStore.value!.tracks[0]!.clips).toMatchObject([{ id: 'clip-a' }, { id: 'clip-b' }]);
        stepRecordStore.set(null);
        await redo();
        expect(trackStore.value!.tracks[0]!.clips).toMatchObject([{ id: glued.id }]);
    });

    it('keeps the glue and undo entry when a take lane references the generated target', async () => {
        await executeAppActionBatch([{ type: 'glueClips', payload: { clipIds: ['clip-a', 'clip-b'] } }], {
            source: 'prompt',
            requireCompensation: true,
        });
        const glued = trackStore.value!.tracks[0]!.clips[0]!;
        takeLaneStore.set({
            lanes: [
                {
                    id: 'lane-track-midi',
                    trackId: 'track-midi',
                    takes: [
                        {
                            id: 'take-glued',
                            clipId: glued.id,
                            name: 'Glued take',
                            startBeat: 8,
                            endBeat: 16,
                            selected: true,
                        },
                    ],
                    activeCompRegions: [{ startBeat: 8, endBeat: 16, takeId: 'take-glued' }],
                },
            ],
        });
        const previousTakeLanes = structuredClone(takeLaneStore.value);

        await undo();

        expect(trackStore.value!.tracks[0]!.clips).toMatchObject([{ id: glued.id }]);
        expect(takeLaneStore.value).toEqual(previousTakeLanes);

        takeLaneStore.set({ lanes: [] });
        await undo();
        expect(trackStore.value!.tracks[0]!.clips).toMatchObject([{ id: 'clip-a' }, { id: 'clip-b' }]);
    });

    it('keeps the source clips and redo entry when a take lane references a source', async () => {
        await executeAppActionBatch([{ type: 'glueClips', payload: { clipIds: ['clip-a', 'clip-b'] } }], {
            source: 'prompt',
            requireCompensation: true,
        });
        const glued = trackStore.value!.tracks[0]!.clips[0]!;
        await undo();
        takeLaneStore.set({
            lanes: [
                {
                    id: 'lane-track-midi',
                    trackId: 'track-midi',
                    takes: [
                        {
                            id: 'take-clip-a',
                            clipId: 'clip-a',
                            name: 'Take A',
                            startBeat: 8,
                            endBeat: 12,
                            selected: true,
                        },
                    ],
                    activeCompRegions: [{ startBeat: 8, endBeat: 12, takeId: 'take-clip-a' }],
                },
            ],
        });
        const previousTakeLanes = structuredClone(takeLaneStore.value);

        await redo();

        expect(trackStore.value!.tracks[0]!.clips).toMatchObject([{ id: 'clip-a' }, { id: 'clip-b' }]);
        expect(takeLaneStore.value).toEqual(previousTakeLanes);

        takeLaneStore.set({ lanes: [] });
        await redo();
        expect(trackStore.value!.tracks[0]!.clips).toMatchObject([{ id: glued.id }]);
    });

    it('preserves unrelated clip and migration edits through undo and redo', async () => {
        await executeAppActionBatch([{ type: 'glueClips', payload: { clipIds: ['clip-a', 'clip-b'] } }], {
            source: 'prompt',
            requireCompensation: true,
        });
        const glued = trackStore.value!.tracks[0]!.clips[0]!;
        const unrelated = ClipDummy.create({
            id: 'clip-unrelated',
            trackId: 'track-midi',
            name: 'Later edit',
            type: 'midi',
            startBeat: 20,
            endBeat: 24,
        });
        trackStore.set({
            ...trackStore.value!,
            tracks: trackStore.value!.tracks.map((track) =>
                track.id === 'track-midi' ? { ...track, clips: [...track.clips, unrelated] } : track
            ),
        });
        midiStore.set({
            ...midiStore.value!,
            notesByClipId: {
                ...midiStore.value!.notesByClipId,
                'clip-unrelated': [{ id: 'note-unrelated', pitch: 72, startBeat: 0, duration: 1, velocity: 100 }],
            },
            migratedAbsoluteNoteClipIds: [...(midiStore.value!.migratedAbsoluteNoteClipIds ?? []), 'clip-unrelated'],
        });

        await undo();
        expect(trackStore.value!.tracks[0]!.clips).toMatchObject([
            { id: 'clip-a' },
            { id: 'clip-b' },
            { id: 'clip-unrelated', name: 'Later edit' },
        ]);
        expect(midiStore.value!.notesByClipId['clip-unrelated']).toMatchObject([{ id: 'note-unrelated' }]);
        expect(midiStore.value!.migratedAbsoluteNoteClipIds).toEqual(['clip-a', 'clip-b', 'clip-unrelated']);

        await redo();
        expect(trackStore.value!.tracks[0]!.clips).toMatchObject([
            { id: glued.id },
            { id: 'clip-unrelated', name: 'Later edit' },
        ]);
        expect(midiStore.value!.notesByClipId['clip-unrelated']).toMatchObject([{ id: 'note-unrelated' }]);
        expect(midiStore.value!.migratedAbsoluteNoteClipIds).toEqual([glued.id, 'clip-unrelated']);
    });

    it('round-trips interleaved migration markers exactly', async () => {
        midiStore.set({
            ...midiStore.value!,
            migratedAbsoluteNoteClipIds: ['unrelated-1', 'clip-a', 'unrelated-2', 'clip-b', 'unrelated-3'],
        });

        await executeAppActionBatch([{ type: 'glueClips', payload: { clipIds: ['clip-a', 'clip-b'] } }], {
            source: 'prompt',
            requireCompensation: true,
        });
        const glued = trackStore.value!.tracks[0]!.clips[0]!;
        expect(midiStore.value!.migratedAbsoluteNoteClipIds).toEqual([
            'unrelated-1',
            glued.id,
            'unrelated-2',
            'unrelated-3',
        ]);

        await undo();
        expect(midiStore.value!.migratedAbsoluteNoteClipIds).toEqual([
            'unrelated-1',
            'clip-a',
            'unrelated-2',
            'clip-b',
            'unrelated-3',
        ]);

        await redo();
        expect(midiStore.value!.migratedAbsoluteNoteClipIds).toEqual([
            'unrelated-1',
            glued.id,
            'unrelated-2',
            'unrelated-3',
        ]);
    });

    it('preserves a concurrent present-empty migration-list edit', async () => {
        midiStore.set({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        await executeAppActionBatch([{ type: 'glueClips', payload: { clipIds: ['clip-a', 'clip-b'] } }], {
            source: 'prompt',
            requireCompensation: true,
        });
        midiStore.set({ ...midiStore.value!, migratedAbsoluteNoteClipIds: [] });

        await undo();

        expect(midiStore.value).toHaveProperty('migratedAbsoluteNoteClipIds', []);
        expect(trackStore.value!.tracks[0]!.clips).toMatchObject([{ id: 'clip-a' }, { id: 'clip-b' }]);
    });

    it('keeps concurrent insertions on both sides of the glued placeholder', async () => {
        await executeAppActionBatch([{ type: 'glueClips', payload: { clipIds: ['clip-a', 'clip-b'] } }], {
            source: 'prompt',
            requireCompensation: true,
        });
        const glued = trackStore.value!.tracks[0]!.clips[0]!;
        const before = ClipDummy.create({
            id: 'clip-before',
            trackId: 'track-midi',
            name: 'Before',
            type: 'midi',
            startBeat: 0,
            endBeat: 4,
        });
        const after = ClipDummy.create({
            id: 'clip-after',
            trackId: 'track-midi',
            name: 'After',
            type: 'midi',
            startBeat: 20,
            endBeat: 24,
        });
        trackStore.set({
            ...trackStore.value!,
            tracks: trackStore.value!.tracks.map((track) =>
                track.id === 'track-midi' ? { ...track, clips: [before, glued, after] } : track
            ),
        });
        midiStore.set({
            ...midiStore.value!,
            migratedAbsoluteNoteClipIds: ['clip-before', glued.id, 'clip-after'],
        });

        await undo();
        expect(trackStore.value!.tracks[0]!.clips).toMatchObject([
            { id: 'clip-before' },
            { id: 'clip-a' },
            { id: 'clip-b' },
            { id: 'clip-after' },
        ]);
        expect(midiStore.value!.migratedAbsoluteNoteClipIds).toEqual(['clip-before', 'clip-a', 'clip-b', 'clip-after']);

        await redo();
        expect(trackStore.value!.tracks[0]!.clips).toMatchObject([
            { id: 'clip-before' },
            { id: glued.id },
            { id: 'clip-after' },
        ]);
        expect(midiStore.value!.migratedAbsoluteNoteClipIds).toEqual(['clip-before', glued.id, 'clip-after']);
    });
});
