import { inject } from '#/infra/di/inject';
import { CommandEventBus } from '#/modules/Command/useCases';
import { finishToolSwap } from '#/modules/WorkspaceShell/useCases';

/**
 * Handles a keyup event for shortcuts that need release tracking.
 */
export const handleKeyup = inject({ eventBus: CommandEventBus })(
    ({ eventBus: _eventBus }) =>
        function handleKeyup(key: string): void {
            // R-A3: Quick-swap tool (hold beyond 300ms = temporary swap)
            finishToolSwap({ key, timestamp: performance.now() });
        }
);
