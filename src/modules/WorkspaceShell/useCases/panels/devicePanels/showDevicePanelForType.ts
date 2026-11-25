import { inject } from '#/infra/di/inject';

import { devicePanelKindOf } from '../../../models/DevicePanelByDeviceType';
import { WorkspaceEventBus } from '../../workspaceEventBus';

/**
 * Generic dispatch — for cases where the panel event is determined at runtime by device type.
 *
 * Emits the single `panel.showDevice` event, carrying the device type, for every
 * device type that owns a panel; unknown types emit nothing.
 */
export const showDevicePanelForType = inject({ eventBus: WorkspaceEventBus })(
    ({ eventBus }) =>
        function showDevicePanelForType(deviceType: string, deviceId: string): void {
            if (devicePanelKindOf(deviceType) === null) {
                return;
            }

            void eventBus.emit('panel.showDevice', { deviceType, deviceId });
        }
);
