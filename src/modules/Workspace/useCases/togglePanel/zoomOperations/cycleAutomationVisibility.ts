import { inject } from '#/infra/di/inject';

import { WorkspaceEventBus } from '../../workspaceEventBus';

export const cycleAutomationVisibility = inject({ eventBus: WorkspaceEventBus })(
    ({ eventBus }) =>
        function cycleAutomationVisibility(): void {
            void eventBus.emit('panel.showAutomation', undefined);
        }
);
