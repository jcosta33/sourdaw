import { inject } from '#/infra/di/inject';
import { eventBus } from '#/app/registerDependencies';
import { type ShowDevicePanelGenericPayload } from '../../../events/WorkspaceEvents';

/**
 * Generic subscriber — listens for any device panel open request.
 * Replaces the per-device `onPanelShow*.ts` subscribers (which are now deprecated).
 */
export const onShowDevicePanel = inject({ eventBus })(
    ({ eventBus }) =>
        (function onShowDevicePanel(
            handler: (payload: ShowDevicePanelGenericPayload) => void,
        ): () => void {
            return eventBus.on('panel.showDevice', handler);
        })
);
