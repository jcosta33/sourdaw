import { inject } from '#/infra/di/inject';
import { eventBus } from '#/app/registerDependencies';
import { type MidiPedalCcPayload } from '#/modules/Workspace/events/WorkspaceEvents';

export const onMidiPedalCc = inject({ eventBus })(
    ({ eventBus }) =>
        (function onMidiPedalCc(handler: (payload: MidiPedalCcPayload) => void): () => void {
            return eventBus.on('midi.pedalCc', handler);
        })
);