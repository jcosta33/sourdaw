import { inject } from '#/infra/di/inject';

import { WorkspaceEventBus } from '../../workspaceEventBus';

/** @deprecated Use {@link showDevicePanel} with `deviceType: 'levain'` instead. */
export const showLevainPanel = inject({ eventBus: WorkspaceEventBus })(
    ({ eventBus }) =>
        function showLevainPanel(deviceId: string | null): void {
            void eventBus.emit('panel.showLevain', { deviceId });
        }
);
