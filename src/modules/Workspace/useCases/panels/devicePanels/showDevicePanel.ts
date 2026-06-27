import { inject } from '#/infra/di/inject';

import { WorkspaceEventBus } from '../../workspaceEventBus';

/**
 * Generic emitter — opens a device panel for any device type.
 * Replaces the per-device `show*Panel.ts` emitters (which are now deprecated).
 */
export const showDevicePanel = inject({ eventBus: WorkspaceEventBus })(
    ({ eventBus }) =>
        function showDevicePanel(deviceType: string, deviceId: string | null): void {
            void eventBus.emit('panel.showDevice', { deviceType, deviceId });
        }
);
