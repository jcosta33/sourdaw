import { setWebMidiEventBus } from '../../repositories/webMidi/webMidiEventBus';

import type { MidiNoteOffPayload, MidiNoteOnPayload, MidiPedalCcPayload } from '#/modules/WorkspaceShell/events';
import type { YeastNotesOffPayload } from '#/modules/Yeast/events';

type WebMidiRuntimeEvents = {
    'midi.noteOn': MidiNoteOnPayload;
    'midi.noteOff': MidiNoteOffPayload;
    'midi.pedalCc': MidiPedalCcPayload;
    'yeast.notesOff': YeastNotesOffPayload;
};

type WebMidiRuntimeEventBus = {
    emit<TEventName extends keyof WebMidiRuntimeEvents>(
        event: TEventName,
        payload: WebMidiRuntimeEvents[TEventName]
    ): Promise<void>;
    on<TEventName extends keyof WebMidiRuntimeEvents>(
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
