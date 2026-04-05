import { midiStore, type MidiStoreState } from '../stores/midiStore';

export function getMidiStoreState(): MidiStoreState | null {
    return midiStore.value;
}
