import { inject } from '#/infra/di/inject';

import { WorkspaceEventBus } from '../../workspaceEventBus';

/** @deprecated Use {@link showDevicePanel} with `deviceType: 'builtin-crumbs'` instead. */
export const showCrumbsPanel = inject({ eventBus: WorkspaceEventBus })(
    ({ eventBus }) =>
        function showCrumbsPanel(deviceId: string | null): void {
            void eventBus.emit('panel.showCrumbs', { deviceId });
        }
);
