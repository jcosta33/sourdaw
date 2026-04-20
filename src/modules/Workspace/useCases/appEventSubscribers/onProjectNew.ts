import { eventBus } from '#/app/registerDependencies';
import { inject } from '#/infra/di/inject';

export const onProjectNew = inject({ eventBus })(
    ({ eventBus }) =>
        function onProjectNew(handler: () => void): () => void {
            return eventBus.on('project.new', handler);
        }
);
