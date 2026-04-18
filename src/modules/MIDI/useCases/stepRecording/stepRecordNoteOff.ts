import { stepRecordStore } from '../../stores/stepRecordStore';

export function stepRecordNoteOff(pitch: number): void {
    const state = stepRecordStore.value;
    if (!state.active || !state.activeNotes.has(pitch)) return;

    const nextActive = new Set(state.activeNotes);
    nextActive.delete(pitch);
    
    // If all notes are released and we are in advanceOnNoteOff mode, advance the cursor
    let nextBeat = state.currentBeat;
    if (state.advanceOnNoteOff && nextActive.size === 0 && state.activeNotes.size > 0) {
        nextBeat += state.stepSize;
    }

    stepRecordStore.set({ 
        ...state, 
        activeNotes: nextActive,
        currentBeat: nextBeat
    });
}
