import { inject } from '#/infra/di/inject';
import { eventBus } from '#/app/registerDependencies';

export const onProjectSave = inject({ eventBus })(
    ({ eventBus }) =>
        (function onProjectSave(handler: () => void): () => void {
            return eventBus.on('project.save', handler);
        })
);