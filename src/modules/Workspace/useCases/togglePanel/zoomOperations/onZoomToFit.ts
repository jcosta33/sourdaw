import { inject } from '#/infra/di/inject';
import { eventBus } from '#/app/registerDependencies';

export const onZoomToFit = inject({ eventBus })(
    ({ eventBus }) =>
        (function onZoomToFit(handler: () => void): () => void {
            return eventBus.on('zoom.toFit', handler);
        })
);