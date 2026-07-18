import { inject } from '#/infra/di/inject';

import { type ImportMidiPayload } from '../../events/WorkspaceEvents';
import { WorkspaceEventBus } from '../workspaceEventBus';

export const onMidiImport = inject({ eventBus: WorkspaceEventBus })(
    ({ eventBus }) =>
        function onMidiImport(handler: (payload: ImportMidiPayload) => void): () => void {
            return eventBus.on('midi.import', handler);
        }
);
