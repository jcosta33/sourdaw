import { Container } from '#/infra/di/Container';

import type { TrackAddedPayload } from '#/modules/Arrangement/events';
import type { MidiNoteOffPayload, MidiNoteOnPayload, MidiPedalCcPayload } from '#/modules/Workspace/events';

type GrandBouleEvents = {
    'track.added': TrackAddedPayload;
    'midi.noteOn': MidiNoteOnPayload;
    'midi.noteOff': MidiNoteOffPayload;
    'midi.pedalCc': MidiPedalCcPayload;
};

export abstract class GrandBouleEventBus {
    abstract emit<TEventName extends keyof GrandBouleEvents>(
        event: TEventName,
        payload: GrandBouleEvents[TEventName]
    ): Promise<void>;
    abstract on<TEventName extends keyof GrandBouleEvents>(
        event: TEventName,
        handler: (payload: GrandBouleEvents[TEventName]) => void | Promise<void>
    ): () => void;
}

export function setGrandBouleEventBus(event_bus: GrandBouleEventBus): void {
    Container.set(GrandBouleEventBus, event_bus);
}
