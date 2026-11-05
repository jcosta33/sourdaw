import { setWebMidiEventBus } from '../../repositories/webMidi/webMidiEventBus';

import type { MidiNoteOffPayload, MidiNoteOnPayload, MidiPedalCcPayload } from '#/modules/WorkspaceShell/events';

/**
 * The Note Offs a MIDI effect rack's Worker settled, in MIDI's own words. The
 * composition root binds the app bus that carries Yeast's payload, so that
 * binding checks this shape against Yeast's own.
 */
type GeneratedNotesOffPayload = {
    trackId: string;
    noteOffs: { channel: number; note: number; noteInstanceId?: string; sampleFrame?: number }[];
};

type WebMidiRuntimeEvents = {
    'midi.noteOn': MidiNoteOnPayload;
    'midi.noteOff': MidiNoteOffPayload;
    'midi.pedalCc': MidiPedalCcPayload;
    'yeast.notesOff': GeneratedNotesOffPayload;
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
