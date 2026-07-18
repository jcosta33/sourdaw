import { inject } from '#/infra/di/inject';
import { type MidiPedalCcPayload } from '#/modules/WorkspaceShell/events';

import { GrandBouleEventBus } from '../grandBouleEventBus';

export const onMidiPedalCc = inject({ eventBus: GrandBouleEventBus })(
    ({ eventBus }) =>
        function onMidiPedalCc(handler: (payload: MidiPedalCcPayload) => void): () => void {
            return eventBus.on('midi.pedalCc', handler);
        }
);
