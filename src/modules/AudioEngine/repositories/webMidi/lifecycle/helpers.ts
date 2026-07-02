import { getActiveInput } from '../getActiveInput';
import { setActiveInput } from '../setActiveInput';
import { webMidiRuntime } from '../state';

type AttachInputInput = {
    input: MIDIInput;
    onMidiMessage: (event: MIDIMessageEvent) => void;
};

export function attachInput({ input, onMidiMessage }: AttachInputInput): void {
    const current = getActiveInput();
    const listener = onMidiMessage as EventListener;
    if (
        current &&
        webMidiRuntime.midiMessageListener &&
        (current !== input || webMidiRuntime.midiMessageListener !== listener)
    ) {
        current.removeEventListener('midimessage', webMidiRuntime.midiMessageListener);
    }
    setActiveInput(input);
    webMidiRuntime.midiMessageListener = listener;
    input.addEventListener('midimessage', listener);
}
