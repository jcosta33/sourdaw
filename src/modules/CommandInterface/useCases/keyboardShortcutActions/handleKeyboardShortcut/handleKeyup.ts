import { inject } from '#/infra/di/inject';
import { CommandEventBus } from '#/modules/Command/useCases';
import { finishToolSwap } from '#/modules/Workspace/useCases';

/**
 * Handles a keyup event for shortcuts that need release tracking.
 */
export const handleKeyup = inject({ eventBus: CommandEventBus })(
    ({ eventBus }) =>
        function handleKeyup(key: string): void {
            if (key === 'v') {
                void eventBus.emit('voice.toggle', { active: false });
            }

            // R-A3: Quick-swap tool (hold beyond 300ms = temporary swap)
            finishToolSwap({ key, timestamp: performance.now() });
        }
);
