import { inject } from '#/infra/di/inject';

import { WorkspaceEventBus } from '../../workspaceEventBus';

/** @deprecated Use {@link showDevicePanel} with `deviceType: 'automation'` instead. */
export const showAutomationPanel = inject({ eventBus: WorkspaceEventBus })(
    ({ eventBus }) =>
        function showAutomationPanel(): void {
            void eventBus.emit('panel.showAutomation', undefined);
        }
);
