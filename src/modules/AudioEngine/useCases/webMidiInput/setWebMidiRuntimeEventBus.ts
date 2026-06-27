import type { MidiNoteOffPayload, MidiNoteOnPayload, MidiPedalCcPayload } from '#/modules/Workspace/events';
import type { YeastNotesOffPayload } from '#/modules/Yeast/events';

import { setWebMidiEventBus } from '../../repositories/webMidi/webMidiEventBus';

type WebMidiRuntimeEvents = {
    'midi.noteOn': MidiNoteOnPayload;
    'midi.noteOff': MidiNoteOffPayload;
    'midi.pedalCc': MidiPedalCcPayload;
    'yeast.notesOff': YeastNotesOffPayload;
};

type WebMidiRuntimeEventBus = {
    emit<TEventName extends keyof WebMidiRuntimeEvents & string>(
        event: TEventName,
        payload: WebMidiRuntimeEvents[TEventName]
    ): Promise<void>;
    on<TEventName extends keyof WebMidiRuntimeEvents & string>(
        event: TEventName,
        handler: (payload: WebMidiRuntimeEvents[TEventName]) => void | Promise<void>
    ): () => void;
};

type SetWebMidiRuntimeEventBusInput = {
    eventBus: WebMidiRuntimeEventBus;
};

export function setWebMidiRuntimeEventBus({ eventBus }: SetWebMidiRuntimeEventBusInput): void {
    setWebMidiEventBus(eventBus);
}
