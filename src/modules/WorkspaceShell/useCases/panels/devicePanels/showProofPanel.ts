import { inject } from '#/infra/di/inject';

import { WorkspaceEventBus } from '../../workspaceEventBus';

/** @deprecated Use {@link showDevicePanel} with `deviceType: 'proof'` instead. */
export const showProofPanel = inject({ eventBus: WorkspaceEventBus })(
    ({ eventBus }) =>
        function showProofPanel(deviceId: string | null): void {
            void eventBus.emit('panel.showProof', { deviceId });
        }
);
