import { inject } from '#/infra/di/inject';
import { eventBus } from '#/app/registerDependencies';

/** @deprecated Use {@link showDevicePanel} with `deviceType: 'native-scoring'` instead. */
export const showScoringPanel = inject({ eventBus })(
    ({ eventBus }) =>
        (function showScoringPanel(deviceId: string | null): void {
            eventBus.emit('panel.showScoring', { deviceId });
        })
);