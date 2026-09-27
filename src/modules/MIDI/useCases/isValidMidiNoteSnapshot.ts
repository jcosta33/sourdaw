import { isMidiNoteSnapshot } from '../transformers/isMidiNoteSnapshot';

/** Admit a complete note array using the MIDI owner's stored-note rules. */
export function isValidMidiNoteSnapshot(value: unknown): boolean {
    return isMidiNoteSnapshot(value);
}
