import { inject } from '#/infra/di/inject';

import { WorkspaceEventBus } from '../../workspaceEventBus';

/** @deprecated Use {@link onShowDevicePanel} and filter by `deviceType` instead. */
export const onPanelShowAutomation = inject({ eventBus: WorkspaceEventBus })(
    ({ eventBus }) =>
        function onPanelShowAutomation(handler: () => void): () => void {
            return eventBus.on('panel.showAutomation', handler);
        }
);
