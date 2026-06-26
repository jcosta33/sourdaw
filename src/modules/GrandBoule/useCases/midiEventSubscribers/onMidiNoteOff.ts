import { eventBus } from '#/app/registerDependencies';
import { inject } from '#/infra/di/inject';
import { type MidiNoteOffPayload } from '#/modules/Workspace/events';

export const onMidiNoteOff = inject({ eventBus })(
    ({ eventBus }) =>
        function onMidiNoteOff(handler: (payload: MidiNoteOffPayload) => void): () => void {
            return eventBus.on('midi.noteOff', handler);
        }
);
