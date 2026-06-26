import { eventBus } from '#/app/registerDependencies';
import { inject } from '#/infra/di/inject';
import { type MidiPedalCcPayload } from '#/modules/Workspace/events';

export const onMidiPedalCc = inject({ eventBus })(
    ({ eventBus }) =>
        function onMidiPedalCc(handler: (payload: MidiPedalCcPayload) => void): () => void {
            return eventBus.on('midi.pedalCc', handler);
        }
);
