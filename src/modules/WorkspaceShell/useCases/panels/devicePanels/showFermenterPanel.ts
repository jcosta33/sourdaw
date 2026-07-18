import { inject } from '#/infra/di/inject';

import { WorkspaceEventBus } from '../../workspaceEventBus';

// ── Emitters ──────────────────────────────────────────────────────────────────

/** @deprecated Use {@link showDevicePanel} with `deviceType: 'fermenter'` instead. */
export const showFermenterPanel = inject({ eventBus: WorkspaceEventBus })(
    ({ eventBus }) =>
        function showFermenterPanel(deviceId: string | null): void {
            void eventBus.emit('panel.showFermenter', { deviceId });
        }
);
