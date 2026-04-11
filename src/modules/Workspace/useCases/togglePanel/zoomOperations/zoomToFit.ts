import { inject } from '#/infra/di/inject';
import { eventBus } from '#/app/registerDependencies';

export const zoomToFit = inject({ eventBus })(
    ({ eventBus }) =>
        (function zoomToFit(): void {
            eventBus.emit('zoom.toFit', undefined);
        })
);