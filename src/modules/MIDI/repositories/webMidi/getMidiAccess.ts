import { webMidiRuntime } from './state';

export function getMidiAccess(): MIDIAccess | null {
    return webMidiRuntime.midiAccess;
}
