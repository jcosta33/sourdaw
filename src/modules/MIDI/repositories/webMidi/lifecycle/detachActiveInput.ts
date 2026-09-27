import { getActiveInput } from '../getActiveInput';
import { resetChannelControllerState } from '../resetChannelControllerState';
import { setActiveInput } from '../setActiveInput';
import { webMidiRuntime } from '../state';

export function detachActiveInput(): void {
    const input = getActiveInput();
    const listener = webMidiRuntime.midiMessageListener;

    if (input && listener) {
        input.removeEventListener('midimessage', listener);
    }

    if (input) {
        input.onmidimessage = null;
        resetChannelControllerState();
    }

    webMidiRuntime.midiMessageListener = null;
    setActiveInput(null);
}
