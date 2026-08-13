import { midiStore, sanitizeMidiStoreState } from '../stores/midiStore';

export function hydrateMidiProjectState(state: unknown): void {
    midiStore.set(sanitizeMidiStoreState(state));
}
