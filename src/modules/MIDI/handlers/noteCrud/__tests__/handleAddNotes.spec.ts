import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultTrackState, trackStore } from '#/modules/Arrangement/stores';
import { addClip, createTrack, setTrackStoreState } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import {
    commandProjectRevisionPort,
    createExecutionCommandEnvelope,
    executeAppAction,
    executeVersionedCommandEnvelope,
    serializeVersionedCommandEnvelope,
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
        undoStore.set({ past: [], future: [] });
        resetMidiClipFixture();
        midiStore.set({
            notesByClipId: {
                [CLIP_ID]: [{ id: 'existing', pitch: 48, startBeat: 0, duration: 1, velocity: 80 }],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
    });

    afterEach(() => {
        commandProjectRevisionPort.setProvider(null);
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
        expect(redo.payload.allowMissingExpectedEmpty).toBe(true);

        await handleAddNotes.execute(action);
        expect(handleRestoreMidiClipNotes.execute(inverse)).toEqual({ status: 'written' });
        midiStore.set({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        expect(handleRestoreMidiClipNotes.execute(redo)).toEqual({ status: 'written' });
        expect(currentNotes()).toEqual(redo.payload.notes);
        expect(handleAddNotes.requiresAbortCompensation).toBe(false);
    });

    it('keeps an internal empty note list as a no-op after provider admission has rejected it', () => {
        expect(handleAddNotes.isNoop?.({ type: 'addNotes', payload: { clipId: CLIP_ID, notes: [] } })).toBe(true);
    });

    it('materializes canonical note values before the command envelope persists the action', () => {
        const action = {
            type: 'addNotes' as const,
            payload: {
                clipId: CLIP_ID,
                notes: [{ id: 'note-command-1', pitch: 60.6, startBeat: -2, duration: 0.01, velocity: 96.7 }],
            },
        };

        handleAddNotes.materializeCommandArguments?.(action);

        expect(action.payload.notes).toEqual([
            {
                id: 'note-command-1',
                pitch: 61,
                startBeat: 0,
                duration: 0.0625,
                velocity: 97,
                probability: 100,
            },
        ]);
    });

    it('canonicalizes an envelope-backed addNotes action before persisting its undo entry', async () => {
        commandProjectRevisionPort.setProvider(() => 'revision-envelope');
        const command = createExecutionCommandEnvelope({
            action: {
                type: 'addNotes',
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
            },
            expectedEffect: 'Add one MIDI note.',
            normalizedProjectRevision: 'revision-envelope',
        });

        await executeVersionedCommandEnvelope(serializeVersionedCommandEnvelope(command.envelope));

        expect(undoStore.value?.past.at(-1)).toMatchObject({
            action: {
                type: 'addNotes',
                payload: {
                    clipId: CLIP_ID,
                    notes: [
                        {
                            id: 'note-envelope-1',
                            pitch: 61,
                            startBeat: 0,
                            duration: 0.0625,
                            velocity: 97,
                            probability: 100,
                        },
                    ],
                },
            },
        });
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

        expect(handleRestoreMidiClipNotes.execute(redo)).toEqual({ status: 'conflict' });
        expect(midiStore.value?.notesByClipId).not.toHaveProperty(CLIP_ID);
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
