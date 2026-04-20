import { eventBus } from '#/app/registerDependencies';
import { inject } from '#/infra/di/inject';

/** @deprecated Use {@link showDevicePanel} with `deviceType: 'proof'` instead. */
export const showProofPanel = inject({ eventBus })(
    ({ eventBus }) =>
        function showProofPanel(deviceId: string | null): void {
            void eventBus.emit('panel.showProof', { deviceId });
        }
);
