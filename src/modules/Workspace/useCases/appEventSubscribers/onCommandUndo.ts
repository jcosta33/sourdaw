import { inject } from '#/infra/di/inject';
import { eventBus } from '#/app/registerDependencies';

export const onCommandUndo = inject({ eventBus })(
    ({ eventBus }) =>
        (function onCommandUndo(handler: () => void): () => void {
            return eventBus.on('command.undo', handler);
        })
);