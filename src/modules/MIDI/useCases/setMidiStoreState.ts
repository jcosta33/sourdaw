import { LEGACY_MIDI_PROBABILITY_SEED, midiStore, sanitizeMidiStoreState } from '../stores/midiStore';

export function setMidiStoreState(state: unknown): void {
    const probabilitySeedFallback = midiStore.value?.probabilitySeed ?? LEGACY_MIDI_PROBABILITY_SEED;
    midiStore.set(sanitizeMidiStoreState(state, probabilitySeedFallback));
}
