import { stepRecordStore } from '../../stores/stepRecordStore';
import { addMidiNote } from '../midiNoteCrud/addMidiNote';

export function stepRecordNoteOn(pitch: number, velocity?: number): void {
    const state = stepRecordStore.value;
    if (!state || !state.active || !state.clipId) {
        return;
    }

    const finalVelocity = velocity ?? state.velocity;

    // Add note to current beat
    addMidiNote(state.clipId, pitch, state.currentBeat, state.stepSize, finalVelocity);

    // Track active note
    const nextActive = new Set(state.activeNotes);
    nextActive.add(pitch);

    stepRecordStore.set({
        ...state,
        activeNotes: nextActive,
        currentPitch: pitch,
    });
}
