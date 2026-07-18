import { inject } from '#/infra/di/inject';

import { WorkspaceEventBus } from '../../workspaceEventBus';

/** @deprecated Use {@link showDevicePanel} with `deviceType: 'grand-boule'` instead. */
export const showGrandBoulePanel = inject({ eventBus: WorkspaceEventBus })(
    ({ eventBus }) =>
        function showGrandBoulePanel(deviceId: string | null): void {
            void eventBus.emit('panel.showGrandBoule', { deviceId });
        }
);
