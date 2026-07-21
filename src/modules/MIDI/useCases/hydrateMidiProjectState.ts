import { midiStore, sanitize_midi_store_state } from '../stores/midiStore';

export function hydrateMidiProjectState(state: unknown): void {
    midiStore.set(sanitize_midi_store_state(state));
}
