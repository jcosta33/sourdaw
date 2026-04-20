import { eventBus } from '#/app/registerDependencies';
import { inject } from '#/infra/di/inject';

export const onScrollToPlayhead = inject({ eventBus })(
    ({ eventBus }) =>
        function onScrollToPlayhead(handler: () => void): () => void {
            return eventBus.on('zoom.scrollToPlayhead', handler);
        }
);
