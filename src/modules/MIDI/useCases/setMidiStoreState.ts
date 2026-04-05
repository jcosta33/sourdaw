import { midiStore, type MidiStoreState } from '../stores/midiStore';

export function setMidiStoreState(state: MidiStoreState): void {
    midiStore.set(state);
}
