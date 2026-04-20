import { eventBus } from '#/app/registerDependencies';
import { inject } from '#/infra/di/inject';

import { type ShowDevicePanelPayload } from '../../../events/WorkspaceEvents';

// ── Subscribers ───────────────────────────────────────────────────────────────

/** @deprecated Use {@link onShowDevicePanel} and filter by `deviceType` instead. */
export const onPanelShowFermenter = inject({ eventBus })(
    ({ eventBus }) =>
        function onPanelShowFermenter(handler: (payload: ShowDevicePanelPayload) => void): () => void {
            return eventBus.on('panel.showFermenter', handler);
        }
);
