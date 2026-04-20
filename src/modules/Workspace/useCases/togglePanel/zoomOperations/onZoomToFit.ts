import { eventBus } from '#/app/registerDependencies';
import { inject } from '#/infra/di/inject';

export const onZoomToFit = inject({ eventBus })(
    ({ eventBus }) =>
        function onZoomToFit(handler: () => void): () => void {
            return eventBus.on('zoom.toFit', handler);
        }
);
