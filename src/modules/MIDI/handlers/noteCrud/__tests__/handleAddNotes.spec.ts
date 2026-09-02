import { beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultTrackState, trackStore } from '#/modules/Arrangement/stores';
import { addClip, createTrack, getArrangementHandlers, setTrackStoreState } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    compileVersionedCommandBatchEnvelope,
    createVersionedCommandEnvelope,
    executeAppAction,
    executeAppActionBatch,
    executeVersionedCommandBatch,
    executeVersionedCommandEnvelope,
    migrateLegacyAppActionToVersionedCommandEnvelope,
    parseVersionedCommandEnvelope,
    redo,
    serializeVersionedCommandEnvelope,
    undo,
} from '#/modules/Command/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { type MidiNote } from '../../../models/MidiNote';
import { midiStore } from '../../../stores/midiStore';
import { handleRestoreMidiClipNotes } from '../../noteTransform/handleRestoreMidiClipNotes';
import { handleAddNotes } from '../handleAddNotes';

const CLIP_ID = 'clip-1';
const TRACK_ID = 'track-1';

function resetMidiClipFixture(): void {
    setTrackStoreState({
        ...defaultTrackState,
        tracks: [createTrack({ id: TRACK_ID, kind: 'midi', name: 'MIDI' })],
    });
    if (
        addClip({
            id: CLIP_ID,
            trackId: TRACK_ID,
            startBeat: 0,
            endBeat: 4,
            name: 'MIDI clip',
            type: 'midi',
        }) === null
    ) {
        throw new Error('Expected MIDI clip fixture');
    }
}

function requireRestoreAction(
    action: AppAction | null | undefined
): Extract<AppAction, { type: 'restoreMidiClipNotes' }> {
    if (action?.type !== 'restoreMidiClipNotes') {
        throw new Error('Expected restoreMidiClipNotes action');
    }
    return action;
}

function currentNotes(): MidiNote[] {
    return midiStore.value?.notesByClipId[CLIP_ID] ?? [];
}

describe('handleAddNotes', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        clearHandlerRegistry();
        registerHandlerMap({ addNotes: handleAddNotes, restoreMidiClipNotes: handleRestoreMidiClipNotes });
        clearUndoHistory();
        resetMidiClipFixture();
        midiStore.set({
            notesByClipId: {
                [CLIP_ID]: [{ id: 'existing', pitch: 48, startBeat: 0, duration: 1, velocity: 80 }],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
    });

    it('allocates stable note ids and returns exact guarded inverse and redo snapshots', async () => {
        vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000001');
        const action = {
            type: 'addNotes' as const,
            payload: {
                clipId: CLIP_ID,
                notes: [{ pitch: 60.6, startBeat: 2, duration: 0.01, velocity: 96.7 }],
            },
        };

        const description = handleAddNotes.describe(action);
        const inverse = requireRestoreAction(description.inverseAction);
        const redo = requireRestoreAction(description.redoAction);

        expect(action.payload.notes[0]).not.toHaveProperty('id');
        expect(inverse.payload.notes).toEqual(currentNotes());
        expect(inverse.payload.expectedNotes).toEqual([
            ...currentNotes(),
            {
                id: 'note-00000000-0000-4000-8000-000000000001',
                pitch: 61,
                startBeat: 2,
                duration: 0.0625,
                velocity: 97,
                probability: 100,
            },
        ]);
        expect(redo.payload.notes).toEqual(inverse.payload.expectedNotes);
        expect(redo.payload.expectedNotes).toEqual(inverse.payload.notes);
        expect(inverse.payload.noteTransformReplayGuard).toEqual({
            trackId: TRACK_ID,
            expectedTrackFrozen: false,
            expectedClipLocked: false,
        });
        expect(redo.payload.noteTransformReplayGuard).toEqual(inverse.payload.noteTransformReplayGuard);

        await handleAddNotes.execute(action);
        expect(currentNotes()).toEqual(inverse.payload.expectedNotes);
        expect(handleRestoreMidiClipNotes.execute(inverse)).toEqual({ status: 'written' });
        expect(currentNotes()).toEqual(inverse.payload.notes);
        expect(handleRestoreMidiClipNotes.execute(redo)).toEqual({ status: 'written' });
        expect(currentNotes()).toEqual(redo.payload.notes);
    });

    it('describes an exact inverse before a new MIDI clip note bucket exists', async () => {
        midiStore.set({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000002');
        const action = {
            type: 'addNotes' as const,
            payload: {
                clipId: CLIP_ID,
                notes: [{ pitch: 60, startBeat: 0, duration: 1 }],
            },
        };

        const description = handleAddNotes.describe(action);
        const inverse = requireRestoreAction(description.inverseAction);
        const redo = requireRestoreAction(description.redoAction);

        expect(inverse.payload.notes).toEqual([]);
        expect(inverse.payload.expectedNotes).toEqual([
            {
                id: 'note-00000000-0000-4000-8000-000000000002',
                pitch: 60,
                startBeat: 0,
                duration: 1,
                velocity: 100,
                probability: 100,
            },
        ]);
        await handleAddNotes.execute(action);
        expect(handleRestoreMidiClipNotes.execute(inverse)).toEqual({ status: 'written' });
        expect(handleRestoreMidiClipNotes.execute(redo)).toEqual({ status: 'written' });
        expect(currentNotes()).toEqual(redo.payload.notes);
        expect(handleAddNotes.requiresAbortCompensation).toBe(false);
    });

    it('keeps an internal empty note list as a no-op after provider admission has rejected it', () => {
        expect(handleAddNotes.isNoop?.({ type: 'addNotes', payload: { clipId: CLIP_ID, notes: [] } })).toBe(true);
    });

    it('materializes canonical note values before a provider action gains command-envelope authority', () => {
        const action = {
            type: 'addNotes' as const,
            payload: {
                clipId: CLIP_ID,
                notes: [{ id: 'note-command-1', pitch: 60.6, startBeat: -2, duration: 0.01, velocity: 96.7 }],
            },
        };
        const plannedAction = structuredClone(action);

        const envelope = migrateLegacyAppActionToVersionedCommandEnvelope({
            action,
            expectedEffect: 'Add one MIDI note.',
            normalizedProjectRevision: 'revision-materialized',
        });

        expect(envelope.arguments.notes).toEqual([
            {
                id: 'note-command-1',
                pitch: 61,
                startBeat: 0,
                duration: 0.0625,
                velocity: 97,
                probability: 100,
            },
        ]);
        expect(envelope.time).toEqual([{ argument: 'notes[0].startBeat', domain: 'musical', unit: 'beats', value: 0 }]);
        expect(action).toEqual(plannedAction);
        const serialized = serializeVersionedCommandEnvelope(envelope);

        expect(parseVersionedCommandEnvelope(serialized)).toEqual({ status: 'valid', envelope });
        expect(() =>
            compileVersionedCommandBatchEnvelope({
                baseRevision: 'revision-materialized',
                batchId: 'batch-materialized',
                commands: [serialized],
                intent: 'Add one MIDI note.',
                projectId: 'project-materialized',
                protectedRanges: [{ startBeat: 1, endBeat: 2 }],
                runId: 'run-materialized',
            })
        ).not.toThrow();
    });

    it('canonicalizes an envelope-backed addNotes action before persisting its undo entry', async () => {
        const action = {
            type: 'addNotes' as const,
            payload: {
                clipId: CLIP_ID,
                notes: [
                    {
                        id: 'note-envelope-1',
                        pitch: 60.6,
                        startBeat: -2,
                        duration: 0.01,
                        velocity: 96.7,
                    },
                ],
            },
        };
        const envelope = migrateLegacyAppActionToVersionedCommandEnvelope({
            action,
            expectedEffect: 'Add one MIDI note.',
            normalizedProjectRevision: 'revision-envelope',
        });

        const receipt = await executeVersionedCommandEnvelope(serializeVersionedCommandEnvelope(envelope));

        expect(receipt.commandId).toBe(envelope.commandId);
        const expectedNotes = [
            { id: 'existing', pitch: 48, startBeat: 0, duration: 1, velocity: 80 },
            {
                id: 'note-envelope-1',
                pitch: 61,
                startBeat: 0,
                duration: 0.0625,
                velocity: 97,
                probability: 100,
            },
        ];
        expect(currentNotes()).toEqual(expectedNotes);

        expect(await undo()).toEqual({ headConsumed: true });
        expect(currentNotes()).toEqual([expectedNotes[0]!]);
        await redo();
        expect(currentNotes()).toEqual(expectedNotes);
    });

    it('rejects a raw addNotes action against a supplied envelope before mutation', async () => {
        const action = {
            type: 'addNotes' as const,
            payload: {
                clipId: CLIP_ID,
                notes: [
                    {
                        id: 'note-single-envelope-1',
                        pitch: 60.6,
                        startBeat: -2,
                        duration: 0.01,
                        velocity: 96.7,
                    },
                ],
            },
        };
        const envelope = createVersionedCommandEnvelope({
            action,
            applicationAssignedIds: [{ argument: 'notes[0].id', value: 'note-single-envelope-1' }],
            availableDeviceVersions: {},
            expectedEffect: 'Add one MIDI note.',
            normalizedProjectRevision: 'revision-envelope',
            objectReferences: [{ argument: 'clipId', id: CLIP_ID, scope: 'stable' }],
            parameterUnits: [],
            reason: 'Add one MIDI note.',
            time: [],
        });
        const notesBeforeExecution = currentNotes();

        await expect(executeAppAction(action, { commandEnvelope: envelope })).rejects.toThrow(
            'Command envelope does not match action addNotes'
        );
        expect(action.payload.notes).toEqual([
            { id: 'note-single-envelope-1', pitch: 60.6, startBeat: -2, duration: 0.01, velocity: 96.7 },
        ]);
        expect(currentNotes()).toEqual(notesBeforeExecution);
    });

    it('rejects a raw envelope-backed addNotes batch before mutation', async () => {
        const action = {
            type: 'addNotes' as const,
            payload: {
                clipId: CLIP_ID,
                notes: [
                    {
                        id: 'note-batch-envelope-1',
                        pitch: 60.6,
                        startBeat: -2,
                        duration: 0.01,
                        velocity: 96.7,
                    },
                ],
            },
        };
        const envelope = createVersionedCommandEnvelope({
            action,
            applicationAssignedIds: [{ argument: 'notes[0].id', value: 'note-batch-envelope-1' }],
            availableDeviceVersions: {},
            expectedEffect: 'Add one MIDI note.',
            normalizedProjectRevision: 'revision-envelope',
            objectReferences: [{ argument: 'clipId', id: CLIP_ID, scope: 'stable' }],
            parameterUnits: [],
            reason: 'Add one MIDI note.',
            time: [],
        });
        const notesBeforeExecution = currentNotes();

        await expect(executeAppActionBatch([action], { commandEnvelopes: [envelope] })).resolves.toEqual({
            status: 'rejected',
            reason: 'Command envelope does not match action addNotes',
            actions: [],
        });
        expect(action.payload.notes).toEqual([
            { id: 'note-batch-envelope-1', pitch: 60.6, startBeat: -2, duration: 0.01, velocity: 96.7 },
        ]);
        expect(currentNotes()).toEqual(notesBeforeExecution);
    });

    it('executes a canonical envelope-backed addNotes batch and round-trips its history', async () => {
        const action = {
            type: 'addNotes' as const,
            payload: {
                clipId: CLIP_ID,
                notes: [
                    {
                        id: 'note-batch-envelope-1',
                        pitch: 61,
                        startBeat: 0,
                        duration: 0.0625,
                        velocity: 97,
                        probability: 100,
                    },
                ],
            },
        };
        const envelope = migrateLegacyAppActionToVersionedCommandEnvelope({
            action,
            expectedEffect: 'Add one MIDI note.',
            normalizedProjectRevision: 'revision-envelope',
        });

        await expect(executeAppActionBatch([action], { commandEnvelopes: [envelope] })).resolves.toMatchObject({
            status: 'committed',
        });

        const expectedNotes = [
            { id: 'existing', pitch: 48, startBeat: 0, duration: 1, velocity: 80 },
            {
                id: 'note-batch-envelope-1',
                pitch: 61,
                startBeat: 0,
                duration: 0.0625,
                velocity: 97,
                probability: 100,
            },
        ];
        expect(currentNotes()).toEqual(expectedNotes);

        expect(await undo()).toEqual({ headConsumed: true });
        expect(currentNotes()).toEqual([expectedNotes[0]!]);
        await redo();
        expect(currentNotes()).toEqual(expectedNotes);
    });

    it('compiles and executes two canonical notes alongside an independent tempo command', async () => {
        const observedTempo: number[] = [];
        registerHandlerMap({
            setTempo: {
                describe: () => ({ label: 'Set tempo' }),
                execute: (action) => {
                    observedTempo.push(action.payload.bpm);
                },
                undoable: false,
                validate: () => true,
            },
        });
        const addNotesAction = {
            type: 'addNotes' as const,
            payload: {
                clipId: CLIP_ID,
                notes: [
                    {
                        id: 'note-batch-1',
                        pitch: 61,
                        startBeat: 0,
                        duration: 0.0625,
                        velocity: 97,
                        probability: 100,
                    },
                    {
                        id: 'note-batch-2',
                        pitch: 63,
                        startBeat: 1,
                        duration: 0.5,
                        velocity: 81,
                        probability: 100,
                    },
                ],
            },
        };
        const addNotesEnvelope = createVersionedCommandEnvelope({
            action: addNotesAction,
            applicationAssignedIds: [
                { argument: 'notes[0].id', value: 'note-batch-1' },
                { argument: 'notes[1].id', value: 'note-batch-2' },
            ],
            availableDeviceVersions: {},
            expectedEffect: 'Add two MIDI notes.',
            normalizedProjectRevision: 'revision-batch',
            objectReferences: [
                { argument: 'clipId', id: CLIP_ID, scope: 'stable' },
                { argument: 'notes[0].id', id: 'note-batch-1', scope: 'stable' },
                { argument: 'notes[1].id', id: 'note-batch-2', scope: 'stable' },
            ],
            parameterUnits: [
                { argument: 'notes[0].pitch', unit: 'unitless' },
                { argument: 'notes[0].startBeat', unit: 'beats' },
                { argument: 'notes[0].duration', unit: 'unitless' },
                { argument: 'notes[0].velocity', unit: 'unitless' },
                { argument: 'notes[0].probability', unit: 'unitless' },
                { argument: 'notes[1].pitch', unit: 'unitless' },
                { argument: 'notes[1].startBeat', unit: 'beats' },
                { argument: 'notes[1].duration', unit: 'unitless' },
                { argument: 'notes[1].velocity', unit: 'unitless' },
                { argument: 'notes[1].probability', unit: 'unitless' },
            ],
            reason: 'Add two MIDI notes.',
            time: [
                { argument: 'notes[0].startBeat', domain: 'musical', unit: 'beats', value: 0 },
                { argument: 'notes[1].startBeat', domain: 'musical', unit: 'beats', value: 1 },
            ],
        });
        const setTempoAction = { type: 'setTempo' as const, payload: { bpm: 128 } };
        const setTempoEnvelope = createVersionedCommandEnvelope({
            action: setTempoAction,
            availableDeviceVersions: {},
            expectedEffect: 'Set the tempo to 128 beats per minute.',
            normalizedProjectRevision: 'revision-batch',
            objectReferences: [],
            parameterUnits: [{ argument: 'bpm', unit: 'beats-per-minute' }],
            reason: 'Set the tempo to 128 beats per minute.',
            time: [],
        });
        const commands = [
            serializeVersionedCommandEnvelope(addNotesEnvelope),
            serializeVersionedCommandEnvelope(setTempoEnvelope),
        ];

        expect(
            compileVersionedCommandBatchEnvelope({
                baseRevision: 'revision-batch',
                batchId: 'batch-add-notes-and-tempo',
                commands,
                intent: 'Add two MIDI notes and set the tempo.',
                projectId: 'project-batch',
                runId: 'run-add-notes-and-tempo',
            })
        ).toMatchObject({ authority: { baseRevision: 'revision-batch' } });

        await expect(
            executeVersionedCommandBatch({ commands, normalizedProjectRevision: 'revision-batch' })
        ).resolves.toMatchObject({ status: 'committed' });

        expect(observedTempo).toEqual([128]);
        const expectedNotes = [
            { id: 'existing', pitch: 48, startBeat: 0, duration: 1, velocity: 80 },
            {
                id: 'note-batch-1',
                pitch: 61,
                startBeat: 0,
                duration: 0.0625,
                velocity: 97,
                probability: 100,
            },
            {
                id: 'note-batch-2',
                pitch: 63,
                startBeat: 1,
                duration: 0.5,
                velocity: 81,
                probability: 100,
            },
        ];
        expect(currentNotes()).toEqual(expectedNotes);

        expect(await undo()).toEqual({ headConsumed: true });
        expect(currentNotes()).toEqual([expectedNotes[0]!]);
        await redo();
        expect(currentNotes()).toEqual(expectedNotes);
    });

    it('executes a non-empty addNotes command through the registered Command handler path', async () => {
        const action = {
            type: 'addNotes' as const,
            payload: { clipId: CLIP_ID, notes: [{ pitch: 60, startBeat: 0, duration: 1 }] },
        };

        expect(handleAddNotes.isNoop?.(action)).toBe(false);
        await executeAppAction(action, { skipUndo: true });

        expect(currentNotes()).toContainEqual(expect.objectContaining({ pitch: 60, startBeat: 0, duration: 1 }));
    });

    it('fails closed before mutating when the writable MIDI target becomes frozen', async () => {
        const action = {
            type: 'addNotes' as const,
            payload: { clipId: CLIP_ID, notes: [{ id: 'note-1', pitch: 60, startBeat: 0, duration: 1 }] },
        };
        setTrackStoreState({
            ...defaultTrackState,
            tracks: trackStore.value!.tracks.map((track) => ({ ...track, frozen: true })),
        });

        expect(handleAddNotes.describe(action).inverseAction).toBeNull();
        expect(handleAddNotes.execute(action)).toEqual({ status: 'conflict' });
        expect(currentNotes()).toEqual([{ id: 'existing', pitch: 48, startBeat: 0, duration: 1, velocity: 80 }]);
    });

    it.each([
        [
            'duplicates a materialized note id in one action',
            [
                { id: 'note-duplicate', pitch: 60, startBeat: 0, duration: 1, velocity: 100 },
                { id: 'note-duplicate', pitch: 64, startBeat: 1, duration: 1, velocity: 96 },
            ],
        ],
        [
            'collides with a note already in the target clip',
            [{ id: 'existing', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }],
        ],
    ])('rejects addNotes before writing when it %s', async (_description, notes) => {
        const action = { type: 'addNotes' as const, payload: { clipId: CLIP_ID, notes } };
        const notesBeforeExecution = currentNotes();

        await expect(executeAppAction(action)).rejects.toThrow('Action conflicts with current project state: addNotes');

        expect(currentNotes()).toEqual(notesBeforeExecution);
    });

    it('executes an addTrack, addClip, addNotes atomic batch on its batch-local MIDI clip', async () => {
        registerHandlerMap(getArrangementHandlers());
        const actions = [
            {
                type: 'addTrack' as const,
                payload: { id: 'track-batch-midi', name: 'Batch MIDI', kind: 'midi' as const },
            },
            {
                type: 'addClip' as const,
                payload: {
                    id: 'clip-batch-midi',
                    trackId: 'track-batch-midi',
                    startBeat: 0,
                    endBeat: 4,
                    name: 'Batch MIDI clip',
                    type: 'midi' as const,
                },
            },
            {
                type: 'addNotes' as const,
                payload: {
                    clipId: 'clip-batch-midi',
                    notes: [{ id: 'note-batch-local', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }],
                },
            },
        ];

        await expect(
            executeAppActionBatch(actions, { groupId: 'batch-local-midi', requireCompensation: true })
        ).resolves.toMatchObject({ status: 'committed' });
        expect(midiStore.value?.notesByClipId['clip-batch-midi']).toEqual([
            { id: 'note-batch-local', pitch: 60, startBeat: 0, duration: 1, velocity: 100, probability: 100 },
        ]);

        expect(await undo()).toEqual({ headConsumed: true });
        expect(trackStore.value?.tracks.some((track) => track.id === 'track-batch-midi')).toBe(false);
    });

    it('rejects a noncanonical planned action against a frozen target without mutating its caller payload', async () => {
        const action = {
            type: 'addNotes' as const,
            payload: {
                clipId: CLIP_ID,
                notes: [{ id: 'note-frozen-single', pitch: 60.6, startBeat: -2, duration: 0.01, velocity: 96.7 }],
            },
        };
        const plannedAction = structuredClone(action);
        setTrackStoreState({
            ...defaultTrackState,
            tracks: trackStore.value!.tracks.map((track) => ({ ...track, frozen: true })),
        });
        const projectStateBeforeExecution = structuredClone(trackStore.value);
        const midiStateBeforeExecution = structuredClone(midiStore.value);

        await expect(executeAppAction(action)).rejects.toThrow('Action conflicts with current project state: addNotes');

        expect(action).toEqual(plannedAction);
        expect(trackStore.value).toEqual(projectStateBeforeExecution);
        expect(midiStore.value).toEqual(midiStateBeforeExecution);
    });

    it('rejects a noncanonical planned batch against a frozen target without mutating its caller payload', async () => {
        const action = {
            type: 'addNotes' as const,
            payload: {
                clipId: CLIP_ID,
                notes: [{ id: 'note-frozen-batch', pitch: 60.6, startBeat: -2, duration: 0.01, velocity: 96.7 }],
            },
        };
        const plannedAction = structuredClone(action);
        setTrackStoreState({
            ...defaultTrackState,
            tracks: trackStore.value!.tracks.map((track) => ({ ...track, frozen: true })),
        });
        const projectStateBeforeExecution = structuredClone(trackStore.value);
        const midiStateBeforeExecution = structuredClone(midiStore.value);

        await expect(executeAppActionBatch([action])).resolves.toEqual({
            status: 'conflicted',
            reason: 'Action conflicts with current project state: addNotes',
            actions: [],
        });

        expect(action).toEqual(plannedAction);
        expect(trackStore.value).toEqual(projectStateBeforeExecution);
        expect(midiStore.value).toEqual(midiStateBeforeExecution);
    });

    it.each([
        [
            'an empty unlocked MIDI clip',
            true,
            () => midiStore.set({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} }),
        ],
        ['a missing clip', false, () => setTrackStoreState({ ...defaultTrackState, tracks: [] })],
        [
            'an audio clip',
            false,
            () =>
                setTrackStoreState({
                    ...defaultTrackState,
                    tracks: [
                        {
                            ...trackStore.value!.tracks[0]!,
                            clips: [{ ...trackStore.value!.tracks[0]!.clips[0]!, type: 'audio' }],
                        },
                    ],
                }),
        ],
        [
            'a locked MIDI clip',
            false,
            () =>
                setTrackStoreState({
                    ...defaultTrackState,
                    tracks: [
                        {
                            ...trackStore.value!.tracks[0]!,
                            clips: [{ ...trackStore.value!.tracks[0]!.clips[0]!, locked: true }],
                        },
                    ],
                }),
        ],
        [
            'a frozen owning track',
            false,
            () =>
                setTrackStoreState({
                    ...defaultTrackState,
                    tracks: trackStore.value!.tracks.map((track) => ({ ...track, frozen: true })),
                }),
        ],
    ])('validates %s as writable MIDI capability: %s', (_target, expected, setTargetState) => {
        const action = {
            type: 'addNotes' as const,
            payload: { clipId: CLIP_ID, notes: [{ id: 'note-1', pitch: 60, startBeat: 0, duration: 1 }] },
        };
        setTargetState();

        expect(handleAddNotes.validate?.(action, { actions: [action], actionIndex: 0 })).toBe(expected);
    });

    it('conflicts rather than writing an orphan note bucket when redo reaches a removed clip', async () => {
        midiStore.set({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        const action = {
            type: 'addNotes' as const,
            payload: { clipId: CLIP_ID, notes: [{ id: 'note-1', pitch: 60, startBeat: 0, duration: 1 }] },
        };
        const description = handleAddNotes.describe(action);
        const inverse = requireRestoreAction(description.inverseAction);
        const redo = requireRestoreAction(description.redoAction);

        await handleAddNotes.execute(action);
        expect(handleRestoreMidiClipNotes.execute(inverse)).toEqual({ status: 'written' });
        setTrackStoreState({ ...defaultTrackState, tracks: [] });
        const midiStateBeforeRedo = structuredClone(midiStore.value);

        expect(handleRestoreMidiClipNotes.execute(redo)).toEqual({ status: 'conflict' });
        expect(midiStore.value).toEqual(midiStateBeforeRedo);
    });

    it('conflicts without writing when redo reaches the same clip under a different MIDI track', async () => {
        const action = {
            type: 'addNotes' as const,
            payload: { clipId: CLIP_ID, notes: [{ id: 'note-1', pitch: 60, startBeat: 0, duration: 1 }] },
        };
        const description = handleAddNotes.describe(action);
        const inverse = requireRestoreAction(description.inverseAction);
        const redo = requireRestoreAction(description.redoAction);

        await handleAddNotes.execute(action);
        expect(handleRestoreMidiClipNotes.execute(inverse)).toEqual({ status: 'written' });
        const originalTrack = trackStore.value!.tracks[0]!;
        const relocatedTrack = createTrack({ id: 'track-2', kind: 'midi', name: 'Relocated MIDI' });
        setTrackStoreState({
            ...defaultTrackState,
            tracks: [
                { ...originalTrack, clips: [] },
                { ...relocatedTrack, clips: [originalTrack.clips[0]!] },
            ],
        });

        expect(handleRestoreMidiClipNotes.execute(redo)).toEqual({ status: 'conflict' });
        expect(currentNotes()).toEqual(inverse.payload.notes);
    });

    it.each([
        [
            'an audio replacement',
            () => ({
                ...trackStore.value!.tracks[0]!,
                clips: [{ ...trackStore.value!.tracks[0]!.clips[0]!, type: 'audio' as const }],
            }),
        ],
        [
            'a locked replacement',
            () => ({
                ...trackStore.value!.tracks[0]!,
                clips: [{ ...trackStore.value!.tracks[0]!.clips[0]!, locked: true }],
            }),
        ],
        ['a frozen owner', () => ({ ...trackStore.value!.tracks[0]!, frozen: true })],
    ])('conflicts when redo reaches %s', (_description, mutateTrack) => {
        const action = {
            type: 'addNotes' as const,
            payload: { clipId: CLIP_ID, notes: [{ id: 'note-1', pitch: 60, startBeat: 0, duration: 1 }] },
        };
        const redo = requireRestoreAction(handleAddNotes.describe(action).redoAction);
        setTrackStoreState({ ...defaultTrackState, tracks: [mutateTrack()] });

        expect(handleRestoreMidiClipNotes.execute(redo)).toEqual({ status: 'conflict' });
    });
});
