import { stepRecordStore } from '../../stores/stepRecordStore';
import { addMidiNote } from '../midiNoteCrud/addMidiNote';
import { projectStore } from '#/modules/Project';
import { quantizeMidiNoteToScale } from '#/utils/Music/MusicalScale';

export function stepRecordNoteOn(pitch: number, velocity?: number): void {
    const state = stepRecordStore.value;
    if (!state.active || !state.clipId) return;

    const project = projectStore.value;
    const finalPitch = state.quantizeToScale 
        ? quantizeMidiNoteToScale(pitch, project.keyRoot, project.scaleName)
        : pitch;

    // Add note to clip
    addMidiNote(state.clipId, finalPitch, state.currentBeat, state.stepSize, velocity ?? state.velocity);

    // Update active notes
    const nextActive = new Set(state.activeNotes);
    nextActive.add(pitch);
    stepRecordStore.set({ ...state, activeNotes: nextActive });

    // If not waiting for note-off, advance immediately (monophonic behavior)
    if (!state.advanceOnNoteOff) {
        stepRecordStore.set({ 
            ...stepRecordStore.value, 
            currentBeat: state.currentBeat + state.stepSize 
        });
    }
}
