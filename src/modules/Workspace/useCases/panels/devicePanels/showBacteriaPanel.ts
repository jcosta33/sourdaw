import { inject } from '#/infra/di/inject';

import { WorkspaceEventBus } from '../../workspaceEventBus';

/** @deprecated Use {@link showDevicePanel} with `deviceType: 'bacteria'` instead. */
export const showBacteriaPanel = inject({ eventBus: WorkspaceEventBus })(
    ({ eventBus }) =>
        function showBacteriaPanel(deviceId: string | null): void {
            void eventBus.emit('panel.showBacteria', { deviceId });
        }
);
