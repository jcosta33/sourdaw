import { inject } from '#/infra/di/inject';
import { eventBus } from '#/app/registerDependencies';

export const onScrollToPlayhead = inject({ eventBus })(
    ({ eventBus }) =>
        (function onScrollToPlayhead(handler: () => void): () => void {
            return eventBus.on('zoom.scrollToPlayhead', handler);
        })
);