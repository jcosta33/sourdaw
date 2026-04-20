import { eventBus } from '#/app/registerDependencies';
import { inject } from '#/infra/di/inject';

import { type ShowDevicePanelPayload } from '../../../events/WorkspaceEvents';

/** @deprecated Use {@link onShowDevicePanel} and filter by `deviceType` instead. */
export const onPanelShowGluten = inject({ eventBus })(
    ({ eventBus }) =>
        function onPanelShowGluten(handler: (payload: ShowDevicePanelPayload) => void): () => void {
            return eventBus.on('panel.showGluten', handler);
        }
);
