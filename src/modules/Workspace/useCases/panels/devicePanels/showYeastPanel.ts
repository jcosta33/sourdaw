import { inject } from '#/infra/di/inject';

import { WorkspaceEventBus } from '../../workspaceEventBus';

/** @deprecated Use {@link showDevicePanel} with `deviceType: 'yeast'` instead. */
export const showYeastPanel = inject({ eventBus: WorkspaceEventBus })(
    ({ eventBus }) =>
        function showYeastPanel(deviceId: string | null): void {
            void eventBus.emit('panel.showYeast', { deviceId });
        }
);
