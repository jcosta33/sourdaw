import { eventBus } from '#/app/registerDependencies';
import { inject } from '#/infra/di/inject';

export const zoomToFit = inject({ eventBus })(
    ({ eventBus }) =>
        function zoomToFit(): void {
            void eventBus.emit('zoom.toFit', undefined);
        }
);
