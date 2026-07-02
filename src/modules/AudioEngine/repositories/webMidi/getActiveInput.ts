import { webMidiRuntime } from './state';

export function getActiveInput(): MIDIInput | null {
    return webMidiRuntime.activeInput;
}
