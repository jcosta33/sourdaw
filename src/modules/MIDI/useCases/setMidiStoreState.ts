import { LEGACY_MIDI_PROBABILITY_SEED, midiStore, sanitize_midi_store_state } from '../stores/midiStore';

export function setMidiStoreState(state: unknown): void {
    const probabilitySeedFallback = midiStore.value?.probabilitySeed ?? LEGACY_MIDI_PROBABILITY_SEED;
    midiStore.set(sanitize_midi_store_state(state, probabilitySeedFallback));
}
