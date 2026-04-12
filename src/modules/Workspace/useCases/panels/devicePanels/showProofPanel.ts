import { inject } from '#/infra/di/inject';
import { eventBus } from '#/app/registerDependencies';

/** @deprecated Use {@link showDevicePanel} with `deviceType: 'proof'` instead. */
export const showProofPanel = inject({ eventBus })(
    ({ eventBus }) =>
        (function showProofPanel(deviceId: string | null): void {
            eventBus.emit('panel.showProof', { deviceId });
        })
);