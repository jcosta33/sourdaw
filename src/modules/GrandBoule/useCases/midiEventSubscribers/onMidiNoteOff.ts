import { inject } from '#/infra/di/inject';
import { type MidiNoteOffPayload } from '#/modules/WorkspaceShell/events';

import { GrandBouleEventBus } from '../grandBouleEventBus';

export const onMidiNoteOff = inject({ eventBus: GrandBouleEventBus })(
    ({ eventBus }) =>
        function onMidiNoteOff(handler: (payload: MidiNoteOffPayload) => void): () => void {
            return eventBus.on('midi.noteOff', handler);
        }
);
