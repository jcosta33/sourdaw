import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { type MidiNote } from '../../../models/MidiNote';
import { midiStore } from '../../../stores/midiStore';
import { handleRestoreMidiClipNotes } from '../../noteTransform/handleRestoreMidiClipNotes';
import { handleAddNotes } from '../handleAddNotes';

const CLIP_ID = 'clip-1';

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
});
