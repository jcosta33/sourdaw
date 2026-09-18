import { pushUndoEntry } from '#/modules/Command/useCases';

import { type MidiNote } from '../../models/MidiNote';
import { stepRecordStore } from '../../stores/stepRecordStore';
import { addMidiNote } from '../midiNoteCrud/addMidiNote';
import { getNotesForClip } from '../midiNoteCrud/getNotesForClip';
import { removeMidiNote } from '../midiNoteCrud/removeMidiNote';
import { setNotesForClip } from '../midiNoteCrud/setNotesForClip';

/** Same history label the mouse step-entry path registers for one step note. */
const STEP_ENTRY_NOTE_UNDO_LABEL = 'Add MIDI note';

/**
 * Re-insert captured note objects whole without minting new ids: the undo unit
 * must restore the exact note identity, and `appendMidiNotes` mints a fresh id
 * per note. Mirrors the piano roll step-entry path's `appendNotesToClip`.
 */
function appendCapturedNotes(clipId: string, notes: readonly MidiNote[]): void {
    setNotesForClip(clipId, [...getNotesForClip(clipId), ...notes]);
}

export function stepRecordNoteOn(pitch: number, velocity?: number): void {
    const state = stepRecordStore.value;
    if (!state || !state.active || !state.clipId) {
        return;
    }

    const clipId = state.clipId;
    const finalVelocity = velocity ?? state.velocity;

    // Add note to current beat
    const note = addMidiNote(clipId, pitch, state.currentBeat, state.stepSize, finalVelocity);

    // Register the same undo unit the mouse step-entry path registers, so a
    // hardware step note has coherent history regardless of input device. The
    // note is final at creation (fixed stepSize length); note-off only moves
    // the step cursor and never amends the note or this entry.
    pushUndoEntry(
        STEP_ENTRY_NOTE_UNDO_LABEL,
        () => removeMidiNote(clipId, note.id),
        () => appendCapturedNotes(clipId, [note])
    );

    // Track active note
    const nextActive = new Set(state.activeNotes);
    nextActive.add(pitch);

    stepRecordStore.set({
        ...state,
        activeNotes: nextActive,
        currentPitch: pitch,
    });
}
