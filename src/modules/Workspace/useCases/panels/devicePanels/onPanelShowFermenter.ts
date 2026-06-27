import { inject } from '#/infra/di/inject';

import { type ShowDevicePanelPayload } from '../../../events/WorkspaceEvents';
import { WorkspaceEventBus } from '../../workspaceEventBus';

// ── Subscribers ───────────────────────────────────────────────────────────────

/** @deprecated Use {@link onShowDevicePanel} and filter by `deviceType` instead. */
export const onPanelShowFermenter = inject({ eventBus: WorkspaceEventBus })(
    ({ eventBus }) =>
        function onPanelShowFermenter(handler: (payload: ShowDevicePanelPayload) => void): () => void {
            return eventBus.on('panel.showFermenter', handler);
        }
);
