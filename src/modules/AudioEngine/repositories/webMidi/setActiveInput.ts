import { webMidiRuntime } from './state';

export function setActiveInput(input: MIDIInput | null): void {
    webMidiRuntime.activeInput = input;
}
