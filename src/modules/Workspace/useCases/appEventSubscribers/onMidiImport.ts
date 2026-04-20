import { eventBus } from '#/app/registerDependencies';
import { inject } from '#/infra/di/inject';

import { type ImportMidiPayload } from '../../events/WorkspaceEvents';

export const onMidiImport = inject({ eventBus })(
    ({ eventBus }) =>
        function onMidiImport(handler: (payload: ImportMidiPayload) => void): () => void {
            return eventBus.on('midi.import', handler);
        }
);
