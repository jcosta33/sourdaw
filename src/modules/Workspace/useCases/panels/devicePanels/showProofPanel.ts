import { inject } from '#/infra/di/inject';
import { eventBus } from '#/app/registerDependencies';

export const showProofPanel = inject({ eventBus })(
    ({ eventBus }) =>
        (function showProofPanel(deviceId: string | null): void {
            eventBus.emit('panel.showProof', { deviceId });
        })
);