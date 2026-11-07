import { inject } from '#/infra/di/inject';

import { type OpenPreferencesPayload } from '../../events/WorkspaceEvents';
import { WorkspaceEventBus } from '../workspaceEventBus';

export const onDialogOpenPreferences = inject({ eventBus: WorkspaceEventBus })(
    ({ eventBus }) =>
        function onDialogOpenPreferences(handler: (payload: OpenPreferencesPayload) => void): () => void {
            return eventBus.on('dialog.openPreferences', handler);
        }
);
