import { inject } from '#/infra/di/inject';
import { eventBus } from '#/app/registerDependencies';

export const onCommandRedo = inject({ eventBus })(
    ({ eventBus }) =>
        (function onCommandRedo(handler: () => void): () => void {
            return eventBus.on('command.redo', handler);
        })
);