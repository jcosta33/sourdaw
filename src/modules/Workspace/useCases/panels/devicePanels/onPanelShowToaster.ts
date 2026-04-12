import { inject } from '#/infra/di/inject';
import { eventBus } from '#/app/registerDependencies';
import { type ShowDevicePanelPayload } from '../../../events/WorkspaceEvents';

/** @deprecated Use {@link onShowDevicePanel} and filter by `deviceType` instead. */
export const onPanelShowToaster = inject({ eventBus })(
    ({ eventBus }) =>
        (function onPanelShowToaster(handler: (payload: ShowDevicePanelPayload) => void): () => void {
            return eventBus.on('panel.showToaster', handler);
        })
);