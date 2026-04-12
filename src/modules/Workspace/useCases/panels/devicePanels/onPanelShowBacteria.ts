import { inject } from '#/infra/di/inject';
import { eventBus } from '#/app/registerDependencies';
import { type ShowDevicePanelPayload } from '../../../events/WorkspaceEvents';

/** @deprecated Use {@link onShowDevicePanel} and filter by `deviceType` instead. */
export const onPanelShowBacteria = inject({ eventBus })(
    ({ eventBus }) =>
        (function onPanelShowBacteria(handler: (payload: ShowDevicePanelPayload) => void): () => void {
            return eventBus.on('panel.showBacteria', handler);
        })
);