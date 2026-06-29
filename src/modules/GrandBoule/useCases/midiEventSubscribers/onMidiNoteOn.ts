import { inject } from '#/infra/di/inject';
import { type MidiNoteOnPayload } from '#/modules/Workspace/events';

import { GrandBouleEventBus } from '../grandBouleEventBus';

export const onMidiNoteOn = inject({ eventBus: GrandBouleEventBus })(
    ({ eventBus }) =>
        function onMidiNoteOn(handler: (payload: MidiNoteOnPayload) => void): () => void {
            return eventBus.on('midi.noteOn', handler);
        }
);
