import { inject } from '#/infra/di/inject';

import { WorkspaceEventBus } from '../../workspaceEventBus';

/** @deprecated Use {@link showDevicePanel} with `deviceType: 'native-scoring'` instead. */
export const showScoringPanel = inject({ eventBus: WorkspaceEventBus })(
    ({ eventBus }) =>
        function showScoringPanel(deviceId: string | null): void {
            void eventBus.emit('panel.showScoring', { deviceId });
        }
);
