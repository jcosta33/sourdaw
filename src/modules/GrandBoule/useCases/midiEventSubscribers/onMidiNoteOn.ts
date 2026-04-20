import { eventBus } from '#/app/registerDependencies';
import { inject } from '#/infra/di/inject';
import { type MidiNoteOnPayload } from '#/modules/Workspace/events/WorkspaceEvents';

export const onMidiNoteOn = inject({ eventBus })(
    ({ eventBus }) =>
        function onMidiNoteOn(handler: (payload: MidiNoteOnPayload) => void): () => void {
            return eventBus.on('midi.noteOn', handler);
        }
);
