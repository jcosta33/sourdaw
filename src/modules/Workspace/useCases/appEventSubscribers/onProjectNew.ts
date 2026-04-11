import { inject } from '#/infra/di/inject';
import { eventBus } from '#/app/registerDependencies';

export const onProjectNew = inject({ eventBus })(
    ({ eventBus }) =>
        (function onProjectNew(handler: () => void): () => void {
            return eventBus.on('project.new', handler);
        })
);