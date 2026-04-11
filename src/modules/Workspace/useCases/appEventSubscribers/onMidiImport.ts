import { inject } from '#/infra/di/inject';
import { eventBus } from '#/app/registerDependencies';
import { type ImportMidiPayload } from '../../events/WorkspaceEvents';

export const onMidiImport = inject({ eventBus })(
    ({ eventBus }) =>
        (function onMidiImport(handler: (payload: ImportMidiPayload) => void): () => void {
            return eventBus.on('midi.import', handler);
        })
);