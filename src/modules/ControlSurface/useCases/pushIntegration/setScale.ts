import { pushStore } from '../../stores/push';

const NOTES_PER_OCTAVE = 12;

export function setScale(rootNote: number, scaleName: string): void {
    const state = pushStore.value;
    if (!state) {
        return;
    }
    // `%` alone returns a negative result for a negative dividend (e.g.
    // -1 % 12 === -1); adding the modulus back before the second `%` yields
    // the positive representative in [0, 12) instead (F-7).
    const wrappedRootNote = ((rootNote % NOTES_PER_OCTAVE) + NOTES_PER_OCTAVE) % NOTES_PER_OCTAVE;
    pushStore.set({ ...state, rootNote: wrappedRootNote, scaleName });
}
