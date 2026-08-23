import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import { clearUndoHistory, executeAppAction, redo, undo } from '#/modules/Command/useCases';
import { type AppAction } from '#/utils/handlerContract';
import { setNotificationEventBus } from '#/utils/Notification/notificationEventBus';

import { type MidiNote } from '../../../models/MidiNote';
import { midiStore } from '../../../stores/midiStore';
import { getMidiNoteTransformHandlers } from '../../../useCases/getMidiNoteTransformHandlers';
import { handleInvertNotes } from '../handleInvertNotes';
import { handleQuantizeNoteLengths } from '../handleQuantizeNoteLengths';
import { handleQuantizeNotes } from '../handleQuantizeNotes';
import { handleRestoreMidiClipNotes } from '../handleRestoreMidiClipNotes';
import { handleRetrogradeNotes } from '../handleRetrogradeNotes';
import { handleScaleAllVelocities } from '../handleScaleAllVelocities';
import { handleSetAllVelocities } from '../handleSetAllVelocities';
import { handleTransposeNotes } from '../handleTransposeNotes';

const CLIP_ID = 'clip-1';

function note(id: string, pitch: number, startBeat: number): MidiNote {
    return {
        id,
        pitch,
        startBeat,
        duration: 0.375,
        velocity: 93,
        probability: 81,
        pressure: 0.45,
        slide: -0.1,
        pitchBend: 1_024,
        pitchBendRangeSemitones: 12,
        channel: 3,
    };
}

function seedNotes(notes: MidiNote[]): MidiNote[] {
    const snapshot = notes.map((candidate) => ({ ...candidate }));
    midiStore.set({
        notesByClipId: { [CLIP_ID]: snapshot.map((candidate) => ({ ...candidate })) },
        ccByClipId: {},
        pitchBendByClipId: {},
    });
    return snapshot;
}

function currentNotes(): MidiNote[] {
    return midiStore.value?.notesByClipId[CLIP_ID] ?? [];
}

function requireRestoreAction(
    action: AppAction | null | undefined
): Extract<AppAction, { type: 'restoreMidiClipNotes' }> {
    if (action?.type !== 'restoreMidiClipNotes') {
        throw new Error('Expected restoreMidiClipNotes inverse');
    }
    return action;
}

describe('MIDI note transform handlers', () => {
    beforeEach(() => {
        midiStore.set({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
    });

    it('quantize captures complete state, restores it exactly, and redoes deterministically', () => {
        const before = seedNotes([note('a', 60, 0.11), note('b', 64, 0.47)]);
        const action = {
            type: 'quantizeNotes' as const,
            payload: { clipId: CLIP_ID, gridSize: 0.25, strength: 0.5, swing: 0.1 },
        };
        const providerAction = structuredClone(action);

        const description = handleQuantizeNotes.describe(action);
        const inverse = requireRestoreAction(description.inverseAction);
        const replay = requireRestoreAction(description.redoAction);

        expect(handleQuantizeNotes.execute(action)).toEqual({ status: 'written' });
        const expectedPostState = currentNotes().map((candidate) => ({ ...candidate }));
        expect(inverse.payload.expectedNotes).toEqual(expectedPostState);
        expect(inverse.payload.notes).toEqual(before);
        expect(replay.payload.expectedNotes).toEqual(before);
        expect(replay.payload.notes).toEqual(expectedPostState);

        expect(handleRestoreMidiClipNotes.execute(inverse)).toEqual({ status: 'written' });
        expect(currentNotes()).toEqual(before);

        expect(handleQuantizeNotes.execute(action)).toEqual({ status: 'written' });
        expect(currentNotes()).toEqual(expectedPostState);
        expect(action).toEqual(providerAction);
        expect(action.payload).not.toHaveProperty('notes');
        expect(action.payload).not.toHaveProperty('expectedNotes');
    });

    it('transpose restores clamped pitches exactly and redoes deterministically', () => {
        const before = seedNotes([note('low', 3, 0), note('high', 125, 0.5)]);
        const action = { type: 'transposeNotes' as const, payload: { clipId: CLIP_ID, semitones: 8 } };
        const providerAction = structuredClone(action);

        const description = handleTransposeNotes.describe(action);
        const inverse = requireRestoreAction(description.inverseAction);

        expect(handleTransposeNotes.execute(action)).toEqual({ status: 'written' });
        const expectedPostState = currentNotes().map((candidate) => ({ ...candidate }));
        expect(expectedPostState.map((candidate) => candidate.pitch)).toEqual([11, 127]);
        expect(inverse.payload.expectedNotes).toEqual(expectedPostState);

        expect(handleRestoreMidiClipNotes.execute(inverse)).toEqual({ status: 'written' });
        expect(currentNotes()).toEqual(before);

        expect(handleTransposeNotes.execute(action)).toEqual({ status: 'written' });
        expect(currentNotes()).toEqual(expectedPostState);
        expect(action).toEqual(providerAction);
    });

    it('gives every deterministic whole-clip transform exact snapshot undo and redo', () => {
        const transforms = [
            {
                label: 'Invert notes',
                describe: () => handleInvertNotes.describe({ type: 'invertNotes', payload: { clipId: CLIP_ID } }),
                execute: () => handleInvertNotes.execute({ type: 'invertNotes', payload: { clipId: CLIP_ID } }),
            },
            {
                label: 'Retrograde notes',
                describe: () =>
                    handleRetrogradeNotes.describe({ type: 'retrogradeNotes', payload: { clipId: CLIP_ID } }),
                execute: () => handleRetrogradeNotes.execute({ type: 'retrogradeNotes', payload: { clipId: CLIP_ID } }),
            },
            {
                label: 'Quantize note lengths',
                describe: () =>
                    handleQuantizeNoteLengths.describe({
                        type: 'quantizeNoteLengths',
                        payload: { clipId: CLIP_ID, gridSize: 0.25 },
                    }),
                execute: () =>
                    handleQuantizeNoteLengths.execute({
                        type: 'quantizeNoteLengths',
                        payload: { clipId: CLIP_ID, gridSize: 0.25 },
                    }),
            },
            {
                label: 'Scale velocities ×0.5',
                describe: () =>
                    handleScaleAllVelocities.describe({
                        type: 'scaleAllVelocities',
                        payload: { clipId: CLIP_ID, factor: 0.5 },
                    }),
                execute: () =>
                    handleScaleAllVelocities.execute({
                        type: 'scaleAllVelocities',
                        payload: { clipId: CLIP_ID, factor: 0.5 },
                    }),
            },
            {
                label: 'Set all velocities to 64',
                describe: () =>
                    handleSetAllVelocities.describe({
                        type: 'setAllVelocities',
                        payload: { clipId: CLIP_ID, velocity: 64 },
                    }),
                execute: () =>
                    handleSetAllVelocities.execute({
                        type: 'setAllVelocities',
                        payload: { clipId: CLIP_ID, velocity: 64 },
                    }),
            },
        ];

        for (const transform of transforms) {
            const before = seedNotes([note('a', 60, 0.11), note('b', 67, 0.62)]);
            const description = transform.describe();
            const inverse = requireRestoreAction(description.inverseAction);
            const replay = requireRestoreAction(description.redoAction);

            expect(description.label).toBe(transform.label);
            expect(transform.execute()).toEqual({ status: 'written' });
            const transformed = currentNotes().map((candidate) => ({ ...candidate }));
            expect(transformed).not.toEqual(before);
            expect(inverse.payload).toEqual({ clipId: CLIP_ID, notes: before, expectedNotes: transformed });
            expect(replay.payload).toEqual({ clipId: CLIP_ID, notes: transformed, expectedNotes: before });

            expect(handleRestoreMidiClipNotes.execute(inverse)).toEqual({ status: 'written' });
            expect(currentNotes()).toEqual(before);
            expect(handleRestoreMidiClipNotes.execute(replay)).toEqual({ status: 'written' });
            expect(currentNotes()).toEqual(transformed);
        }
    });

    it('rejects a stale inverse without overwriting later note edits', () => {
        seedNotes([note('a', 60, 0.11)]);
        const action = { type: 'quantizeNotes' as const, payload: { clipId: CLIP_ID, gridSize: 0.25 } };
        const inverse = requireRestoreAction(handleQuantizeNotes.describe(action).inverseAction);
        expect(handleQuantizeNotes.execute(action)).toEqual({ status: 'written' });

        const laterNote = note('later', 72, 1.25);
        const state = midiStore.value;
        if (!state) {
            throw new Error('Expected MIDI state');
        }
        midiStore.set({
            ...state,
            notesByClipId: { ...state.notesByClipId, [CLIP_ID]: [...currentNotes(), laterNote] },
        });

        expect(handleRestoreMidiClipNotes.execute(inverse)).toEqual({ status: 'conflict' });
        expect(currentNotes()).toContainEqual(laterNote);
    });

    it('reports missing and unchanged transforms as no-ops', () => {
        expect(
            handleQuantizeNotes.isNoop?.({
                type: 'quantizeNotes',
                payload: { clipId: 'missing', gridSize: 0.25 },
            })
        ).toBe(true);
        expect(
            handleTransposeNotes.isNoop?.({
                type: 'transposeNotes',
                payload: { clipId: 'missing', semitones: 12 },
            })
        ).toBe(true);

        seedNotes([note('grid-aligned', 127, 0.5)]);
        expect(
            handleQuantizeNotes.isNoop?.({
                type: 'quantizeNotes',
                payload: { clipId: CLIP_ID, gridSize: 0.25 },
            })
        ).toBe(true);
        expect(
            handleTransposeNotes.isNoop?.({
                type: 'transposeNotes',
                payload: { clipId: CLIP_ID, semitones: 12 },
            })
        ).toBe(true);
    });

    it('returns no-write when a restore is already applied and conflicts when its clip disappeared', () => {
        const before = seedNotes([note('a', 60, 0.11)]);
        const inverse = requireRestoreAction(
            handleTransposeNotes.describe({
                type: 'transposeNotes',
                payload: { clipId: CLIP_ID, semitones: 12 },
            }).inverseAction
        );

        expect(currentNotes()).toEqual(before);
        expect(handleRestoreMidiClipNotes.execute(inverse)).toEqual({ status: 'no-write' });

        const state = midiStore.value;
        if (!state) {
            throw new Error('Expected MIDI state');
        }
        midiStore.set({ ...state, notesByClipId: {} });
        expect(handleRestoreMidiClipNotes.execute(inverse)).toEqual({ status: 'conflict' });
    });
});

describe('MIDI note transforms through AppAction execution', () => {
    beforeEach(() => {
        setNotificationEventBus({ emit: () => Promise.resolve(), on: () => () => undefined });
        configureAutomergeStoragePort(null);
        clearHandlerRegistry();
        registerHandlerMap(getMidiNoteTransformHandlers());
        clearUndoHistory();
        midiStore.set({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
    });

    afterEach(() => {
        clearUndoHistory();
        clearHandlerRegistry();
        configureAutomergeStoragePort(null);
    });

    it('commits quantize through executeAppAction and round-trips exact state through undo and redo', async () => {
        const before = seedNotes([note('a', 60, 0.11), note('b', 64, 0.47)]);

        await executeAppAction({
            type: 'quantizeNotes',
            payload: { clipId: CLIP_ID, gridSize: 0.25 },
        });

        const transformed = currentNotes().map((candidate) => ({ ...candidate }));
        expect(transformed).not.toEqual(before);
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.past[0]?.label).toBe('Quantize notes');

        await undo();

        expect(currentNotes()).toEqual(before);
        expect(undoStore.value?.past).toHaveLength(0);
        expect(undoStore.value?.future).toHaveLength(1);

        await redo();

        expect(currentNotes()).toEqual(transformed);
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.future).toHaveLength(0);
    });

    it('keeps a stale transform undo entry and preserves later divergent notes', async () => {
        seedNotes([note('a', 60, 0.11)]);
        await executeAppAction({
            type: 'transposeNotes',
            payload: { clipId: CLIP_ID, semitones: 7 },
        });
        const laterNote = note('later', 72, 1.25);
        const state = midiStore.value;
        if (!state) {
            throw new Error('Expected MIDI state');
        }
        midiStore.set({
            ...state,
            notesByClipId: { ...state.notesByClipId, [CLIP_ID]: [...currentNotes(), laterNote] },
        });

        await expect(undo()).resolves.toBeUndefined();

        expect(currentNotes()).toContainEqual(laterNote);
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.future).toHaveLength(0);
    });

    it('keeps a stale redo entry and preserves edits made after undo', async () => {
        const before = seedNotes([note('a', 60, 0.11)]);
        await executeAppAction({
            type: 'transposeNotes',
            payload: { clipId: CLIP_ID, semitones: 7 },
        });
        await undo();

        const laterNote = note('later', 72, 1.25);
        const state = midiStore.value;
        if (!state) {
            throw new Error('Expected MIDI state');
        }
        midiStore.set({
            ...state,
            notesByClipId: { ...state.notesByClipId, [CLIP_ID]: [...before, laterNote] },
        });

        await expect(redo()).resolves.toBeUndefined();

        expect(currentNotes()).toEqual([...before, laterNote]);
        expect(undoStore.value?.past).toHaveLength(0);
        expect(undoStore.value?.future).toHaveLength(1);
    });
});
