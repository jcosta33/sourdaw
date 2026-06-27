import { inject } from '#/infra/di/inject';

import { type ConfirmPayload } from '../events/WorkspaceEvents';
import { WorkspaceEventBus } from './workspaceEventBus';

export const onConfirmation = inject({ eventBus: WorkspaceEventBus })(
    ({ eventBus }) =>
        function onConfirmation(handler: (payload: ConfirmPayload) => void): () => void {
            return eventBus.on('ui.confirm', handler);
        }
);
