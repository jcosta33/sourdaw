import { inject } from '#/infra/di/inject';
import { eventBus } from '#/app/registerDependencies';
import { type ShowDevicePanelPayload } from '../../../events/WorkspaceEvents';

// ── Subscribers ───────────────────────────────────────────────────────────────

export const onPanelShowFermenter = inject({ eventBus })(
    ({ eventBus }) =>
        (function onPanelShowFermenter(handler: (payload: ShowDevicePanelPayload) => void): () => void {
            return eventBus.on('panel.showFermenter', handler);
        })
);