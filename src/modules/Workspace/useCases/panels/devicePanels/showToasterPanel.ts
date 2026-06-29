import { inject } from '#/infra/di/inject';

import { WorkspaceEventBus } from '../../workspaceEventBus';

/** @deprecated Use {@link showDevicePanel} with `deviceType: 'toaster'` instead. */
export const showToasterPanel = inject({ eventBus: WorkspaceEventBus })(
    ({ eventBus }) =>
        function showToasterPanel(deviceId: string | null): void {
            void eventBus.emit('panel.showToaster', { deviceId });
        }
);
