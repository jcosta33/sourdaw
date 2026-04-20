import { eventBus } from '#/app/registerDependencies';
import { inject } from '#/infra/di/inject';

import { type ShowDevicePanelPayload } from '../../../events/WorkspaceEvents';

/** @deprecated Use {@link onShowDevicePanel} and filter by `deviceType` instead. */
export const onPanelShowYeast = inject({ eventBus })(
    ({ eventBus }) =>
        function onPanelShowYeast(handler: (payload: ShowDevicePanelPayload) => void): () => void {
            return eventBus.on('panel.showYeast', handler);
        }
);
