import { onMidiMessage } from '../messageHandlers';
import { getActiveInput, setActiveInput } from '../state';

export function attachInput(input: MIDIInput): void {
    const current = getActiveInput();
    if (current && current !== input) {
        current.removeEventListener('midimessage', onMidiMessage as EventListener);
    }
    setActiveInput(input);
    input.addEventListener('midimessage', onMidiMessage as EventListener);
}
