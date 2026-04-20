import { eventBus } from '#/app/registerDependencies';
import { inject } from '#/infra/di/inject';

export const onCommandRedo = inject({ eventBus })(
    ({ eventBus }) =>
        function onCommandRedo(handler: () => void): () => void {
            return eventBus.on('command.redo', handler);
        }
);
