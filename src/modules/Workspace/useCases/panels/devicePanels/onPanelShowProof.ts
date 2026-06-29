import { inject } from '#/infra/di/inject';

import { type ShowDevicePanelPayload } from '../../../events/WorkspaceEvents';
import { WorkspaceEventBus } from '../../workspaceEventBus';

/** @deprecated Use {@link onShowDevicePanel} and filter by `deviceType` instead. */
export const onPanelShowProof = inject({ eventBus: WorkspaceEventBus })(
    ({ eventBus }) =>
        function onPanelShowProof(handler: (payload: ShowDevicePanelPayload) => void): () => void {
            return eventBus.on('panel.showProof', handler);
        }
);
