import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { undoHistoryStore } from '#/modules/Command/stores';
import { clearUndoHistory, redo, undo } from '#/modules/Command/useCases';

import { type MidiNote } from '../../../models/MidiNote';
import { midiStore } from '../../../stores/midiStore';
import { stepRecordStore } from '../../../stores/stepRecordStore';
import { stepRecordNoteOff } from '../stepRecordNoteOff';
import { stepRecordNoteOn } from '../stepRecordNoteOn';

import { makeStepRecordState, resetStepRecordNavigationStores } from './stepRecordNavigationTestHelpers';

const CLIP_ID = 'clip-step-entry';
const UNRELATED_CLIP_ID = 'clip-unrelated';
const UNRELATED_NOTE: MidiNote = {
    id: 'unrelated-note',
    pitch: 40,
    startBeat: 8,
    duration: 1,
    velocity: 64,
};

function seedMidiStore(): void {
    midiStore.set({
        notesByClipId: { [UNRELATED_CLIP_ID]: [{ ...UNRELATED_NOTE }] },
        ccByClipId: {},
        pitchBendByClipId: {},
    });
}

function clearMidiStore(): void {
    midiStore.set({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
}

function currentClipNotes(): MidiNote[] {
    return midiStore.value?.notesByClipId[CLIP_ID] ?? [];
}

function unrelatedClipNotes(): MidiNote[] {
    return midiStore.value?.notesByClipId[UNRELATED_CLIP_ID] ?? [];
}

function activateStepRecording(): void {
    stepRecordStore.set(
        makeStepRecordState({
            active: true,
            clipId: CLIP_ID,
            currentBeat: 4,
            stepSize: 0.5,
            advanceOnNoteOff: true,
        })
    );
}

describe('stepRecordNoteOn undo registration', () => {
    beforeEach(() => {
        clearUndoHistory();
        seedMidiStore();
    });

    afterEach(() => {
        resetStepRecordNavigationStores();
        clearUndoHistory();
        clearMidiStore();
    });

    it('registers the same undo unit the mouse step-entry path registers', () => {
        activateStepRecording();

        stepRecordNoteOn(60, 80);

        const notes = currentClipNotes();
        expect(notes).toHaveLength(1);
        expect(notes[0]).toMatchObject({ pitch: 60, startBeat: 4, duration: 0.5, velocity: 80 });

        expect(undoHistoryStore.value?.past).toHaveLength(1);
        expect(undoHistoryStore.value?.past[0]?.label).toBe('Add MIDI note');
        expect(undoHistoryStore.value?.past[0]?.kind).toBe('callback');
        expect(undoHistoryStore.value?.future).toHaveLength(0);
    });

    it('undoes from an empty history to the exact prior state and redoes the same note identity', async () => {
        activateStepRecording();
        expect(undoHistoryStore.value?.past).toHaveLength(0);

        stepRecordNoteOn(60, 80);
        const created = currentClipNotes()[0];
        expect(created).toMatchObject({ pitch: 60, startBeat: 4, duration: 0.5, velocity: 80 });

        await undo();

        expect(currentClipNotes()).toEqual([]);
        expect(undoHistoryStore.value?.past).toHaveLength(0);
        expect(undoHistoryStore.value?.future).toHaveLength(1);
        expect(unrelatedClipNotes()).toHaveLength(1);

        await redo();

        expect(currentClipNotes()).toEqual([created]);
        expect(undoHistoryStore.value?.past).toHaveLength(1);
        expect(undoHistoryStore.value?.future).toHaveLength(0);
        expect(unrelatedClipNotes()).toHaveLength(1);
    });

    it('keeps chord release-driven cursor advance coherent with the history units', async () => {
        activateStepRecording();

        stepRecordNoteOn(60, 90);
        stepRecordNoteOn(64, 90);
        stepRecordNoteOn(67, 90);

        const chord = currentClipNotes();
        expect(chord.map((note) => note.pitch)).toEqual([60, 64, 67]);
        expect(chord.every((note) => note.startBeat === 4)).toBe(true);
        expect(undoHistoryStore.value?.past).toHaveLength(3);
        expect(stepRecordStore.value?.activeNotes).toEqual(new Set([60, 64, 67]));
        expect(stepRecordStore.value?.currentBeat).toBe(4);

        stepRecordNoteOff(64);

        expect(stepRecordStore.value?.currentBeat).toBe(4);
        expect(stepRecordStore.value?.activeNotes).toEqual(new Set([60, 67]));
        expect(currentClipNotes()).toEqual(chord);
        expect(undoHistoryStore.value?.past).toHaveLength(3);

        stepRecordNoteOff(60);
        stepRecordNoteOff(67);

        expect(stepRecordStore.value?.currentBeat).toBe(4.5);
        expect(stepRecordStore.value?.activeNotes).toEqual(new Set());
        expect(currentClipNotes().map((note) => note.id)).toEqual(chord.map((note) => note.id));
        expect(unrelatedClipNotes()).toHaveLength(1);

        await undo();
        await undo();
        await undo();

        expect(currentClipNotes()).toEqual([]);
        expect(unrelatedClipNotes()).toHaveLength(1);

        await redo();
        await redo();
        await redo();

        expect(currentClipNotes()).toEqual(chord);
        expect(unrelatedClipNotes()).toHaveLength(1);
    });

    it('produces no note and no undo entry when step recording is inactive', () => {
        stepRecordStore.set(makeStepRecordState({ active: false, clipId: CLIP_ID, currentBeat: 4 }));

        stepRecordNoteOn(60, 80);

        expect(currentClipNotes()).toEqual([]);
        expect(undoHistoryStore.value?.past).toHaveLength(0);
    });

    it('produces no note and no undo entry when step recording has no owning clip', () => {
        stepRecordStore.set(makeStepRecordState({ active: true, clipId: null, currentBeat: 4 }));

        stepRecordNoteOn(60, 80);

        expect(currentClipNotes()).toEqual([]);
        expect(undoHistoryStore.value?.past).toHaveLength(0);
    });
});
