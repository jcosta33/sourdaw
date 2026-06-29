import { inject } from '#/infra/di/inject';

import { type ShowDevicePanelGenericPayload } from '../../../events/WorkspaceEvents';
import { WorkspaceEventBus } from '../../workspaceEventBus';

/**
 * Generic subscriber — listens for any device panel open request.
 * Replaces the per-device `onPanelShow*.ts` subscribers (which are now deprecated).
 */
export const onShowDevicePanel = inject({ eventBus: WorkspaceEventBus })(
    ({ eventBus }) =>
        function onShowDevicePanel(handler: (payload: ShowDevicePanelGenericPayload) => void): () => void {
            return eventBus.on('panel.showDevice', handler);
        }
);
