import { inject } from '#/infra/di/inject';

import { WorkspaceEventBus } from '../../workspaceEventBus';

/** @deprecated Use {@link showDevicePanel} with `deviceType: 'dutch-oven'` instead. */
export const showDutchOvenPanel = inject({ eventBus: WorkspaceEventBus })(
    ({ eventBus }) =>
        function showDutchOvenPanel(deviceId: string | null): void {
            void eventBus.emit('panel.showDutchOven', { deviceId });
        }
);
