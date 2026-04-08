import { inject } from '#/infra/di/inject';
import { eventBus } from '#/app/registerDependencies';
import {
    type MidiNoteOnPayload,
    type MidiNoteOffPayload,
    type MidiPedalCcPayload,
} from '#/modules/Workspace/events/WorkspaceEvents';

export const onMidiNoteOn = inject({ eventBus })(
    ({ eventBus }) =>
        function onMidiNoteOn(handler: (payload: MidiNoteOnPayload) => void): () => void {
            return eventBus.on('midi.noteOn', handler);
        }
);

export const onMidiNoteOff = inject({ eventBus })(
    ({ eventBus }) =>
        function onMidiNoteOff(handler: (payload: MidiNoteOffPayload) => void): () => void {
            return eventBus.on('midi.noteOff', handler);
        }
);

export const onMidiPedalCc = inject({ eventBus })(
    ({ eventBus }) =>
        function onMidiPedalCc(handler: (payload: MidiPedalCcPayload) => void): () => void {
            return eventBus.on('midi.pedalCc', handler);
        }
);
