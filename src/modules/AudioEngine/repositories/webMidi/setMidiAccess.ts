import { webMidiRuntime } from './state';

export function setMidiAccess(access: MIDIAccess | null): void {
    webMidiRuntime.midiAccess = access;
}
