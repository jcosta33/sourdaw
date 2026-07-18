import { webMidiStore as webMidiStateStore } from '../../repositories/webMidi/store';

export type MidiInputInfo = {
    id: string;
    name: string;
    manufacturer: string;
};

export const webMidiStore = webMidiStateStore;
