import { inject } from '#/infra/di/inject';
import { eventBus } from '#/app/registerDependencies';
import { type MidiNoteOffPayload } from '#/modules/Workspace/events/WorkspaceEvents';

export const onMidiNoteOff = inject({ eventBus })(
    ({ eventBus }) =>
        (function onMidiNoteOff(handler: (payload: MidiNoteOffPayload) => void): () => void {
            return eventBus.on('midi.noteOff', handler);
        })
);