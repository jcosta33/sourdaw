import { eventBus } from '#/app/registerDependencies';
import { inject } from '#/infra/di/inject';

export const onProjectSave = inject({ eventBus })(
    ({ eventBus }) =>
        function onProjectSave(handler: () => void): () => void {
            return eventBus.on('project.save', handler);
        }
);
