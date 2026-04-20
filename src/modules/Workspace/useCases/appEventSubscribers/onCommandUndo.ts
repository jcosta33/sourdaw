import { eventBus } from '#/app/registerDependencies';
import { inject } from '#/infra/di/inject';

export const onCommandUndo = inject({ eventBus })(
    ({ eventBus }) =>
        function onCommandUndo(handler: () => void): () => void {
            return eventBus.on('command.undo', handler);
        }
);
