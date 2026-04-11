import { inject } from '#/infra/di/inject';
import { eventBus } from '#/app/registerDependencies';

/**
 * Handles a keyup event for shortcuts that need release tracking.
 */
export const handleKeyup = inject({ eventBus })(
    ({ eventBus }) =>
        (function handleKeyup(key: string): void {
            if (key === 'v') {
                eventBus.emit('voice.toggle', { active: false });
            }
        })
);