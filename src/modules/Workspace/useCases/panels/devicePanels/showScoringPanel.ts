import { inject } from '#/infra/di/inject';
import { eventBus } from '#/app/registerDependencies';

export const showScoringPanel = inject({ eventBus })(
    ({ eventBus }) =>
        (function showScoringPanel(deviceId: string | null): void {
            eventBus.emit('panel.showScoring', { deviceId });
        })
);