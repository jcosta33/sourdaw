import { midiLearnStore, type MidiLearnState } from '../stores/midiLearnStore';

export function getMidiLearnState(): MidiLearnState | null {
    return midiLearnStore.value;
}
