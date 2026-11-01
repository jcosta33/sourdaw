import { midiTimeStateCodec } from './midiTimeStateCodec';

/** Validate persisted owner syntax without consulting the current MIDI store. */
export function isValidMidiTimeStateRestorePlan(value: unknown): boolean {
    try {
        return midiTimeStateCodec.decodeRestorePlan(value) !== null;
    } catch {
        return false;
    }
}
