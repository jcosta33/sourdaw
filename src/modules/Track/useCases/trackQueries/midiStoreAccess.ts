/**
 * Cross-module MIDI state accessors.
 *
 * Note: midiStore and midiLearnStore are business-layer stores (contract folders) —
 * cross-module reads/writes are architecturally valid per architecture.md.
 */

import { midiStore } from '#/modules/Midi/stores/midiStore';
import { midiLearnStore, type MidiLearnState } from '#/modules/Midi/stores/midiLearnStore';

/** Get the full midi store state snapshot. */
export function getMidiStoreState(): typeof midiStore.value {
    return midiStore.value;
}

/** Set the midi store state (for recording use cases). */
export function setMidiStoreState(state: NonNullable<typeof midiStore.value>): void {
    midiStore.set(state);
}

/** Get the midi learn state snapshot. */
export function getMidiLearnState(): MidiLearnState | null {
    return midiLearnStore.value;
}
