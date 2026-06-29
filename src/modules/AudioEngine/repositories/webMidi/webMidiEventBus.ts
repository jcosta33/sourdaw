import { Container } from '#/infra/di/Container';

import type { MidiNoteOffPayload, MidiNoteOnPayload, MidiPedalCcPayload } from '#/modules/Workspace/events';
import type { YeastNotesOffPayload } from '#/modules/Yeast/events';

type WebMidiEvents = {
    'midi.noteOn': MidiNoteOnPayload;
    'midi.noteOff': MidiNoteOffPayload;
    'midi.pedalCc': MidiPedalCcPayload;
    'yeast.notesOff': YeastNotesOffPayload;
};

export abstract class WebMidiEventBus {
    abstract emit<TEventName extends keyof WebMidiEvents>(
        event: TEventName,
        payload: WebMidiEvents[TEventName]
    ): Promise<void>;
    abstract on<TEventName extends keyof WebMidiEvents>(
        event: TEventName,
        handler: (payload: WebMidiEvents[TEventName]) => void | Promise<void>
    ): () => void;
}

export function setWebMidiEventBus(event_bus: WebMidiEventBus): void {
    Container.set(WebMidiEventBus, event_bus);
}
