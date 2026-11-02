import { midiLearnStore, sanitizeMidiLearnState } from '../stores/midiLearnStore';

/**
 * Replace the MIDI learn table with a loaded project's. The sanitizer
 * validates here: one malformed mapping degrades to an empty table instead of
 * rejecting the whole project file, and it always disarms `isLearning` so a
 * foreign file cannot capture the next CC.
 */
export function restoreMidiLearnSnapshot(snapshot: unknown): void {
    midiLearnStore.set(sanitizeMidiLearnState(snapshot));
}
