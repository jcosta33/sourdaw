import { type WebMidiInputMessage } from '../../../models/WebMidiTypes';
import { getActiveInput } from '../getActiveInput';
import { setActiveInput } from '../setActiveInput';
import { webMidiRuntime } from '../state';

type AttachInputInput = {
    input: MIDIInput;
    onMidiMessage: (event: WebMidiInputMessage) => void;
};

export function attachInput({ input, onMidiMessage }: AttachInputInput): void {
    const current = getActiveInput();
    // `midimessage` only ever delivers a MIDIMessageEvent, which satisfies
    // WebMidiInputMessage; the checked assignment below proves the handler
    // accepts one before the unavoidable widening to EventListener.
    const midiListener: (event: MIDIMessageEvent) => void = onMidiMessage;
    const listener = midiListener as EventListener;
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
