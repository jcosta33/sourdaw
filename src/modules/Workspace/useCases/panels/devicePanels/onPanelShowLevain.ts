import { inject } from '#/infra/di/inject';

import { type ShowDevicePanelPayload } from '../../../events/WorkspaceEvents';
import { WorkspaceEventBus } from '../../workspaceEventBus';

/** @deprecated Use {@link onShowDevicePanel} and filter by `deviceType` instead. */
export const onPanelShowLevain = inject({ eventBus: WorkspaceEventBus })(
    ({ eventBus }) =>
        function onPanelShowLevain(handler: (payload: ShowDevicePanelPayload) => void): () => void {
            return eventBus.on('panel.showLevain', handler);
        }
);
