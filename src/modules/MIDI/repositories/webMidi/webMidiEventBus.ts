import { Container } from '#/infra/di/Container';

// Structural copies of the Workspace/Yeast event payloads this bus relays.
// Kept local so this repository does not import foreign event contracts
// (repositories-no-business). The use case that binds the concrete bus
// (setWebMidiRuntimeEventBus) supplies the real payload types, and its
// setWebMidiEventBus() call structurally checks them against these shapes.
type MidiNoteOnPayload = { deviceId?: string; midiNote: number; velocity: number };
type MidiNoteOffPayload = { deviceId?: string; midiNote: number; releaseVelocity?: number };
type MidiPedalCcPayload = { deviceId?: string; cc: number; value: number | boolean };
type YeastNoteOffIdentity = { channel: number; note: number; noteInstanceId?: string };
type YeastNotesOffPayload = { trackId: string; noteOffs: YeastNoteOffIdentity[] };

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
