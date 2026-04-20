import { eventBus } from '#/app/registerDependencies';
import { inject } from '#/infra/di/inject';
import { toolSwapStore } from '#/modules/Workspace/stores';
import { setEditingTool } from '#/modules/Workspace/useCases';

/**
 * Handles a keyup event for shortcuts that need release tracking.
 */
export const handleKeyup = inject({ eventBus })(
    ({ eventBus }) =>
        function handleKeyup(key: string): void {
            if (key === 'v') {
                void eventBus.emit('voice.toggle', { active: false });
            }

            // R-A3: Quick-swap tool (hold beyond 300ms = temporary swap)
            const swap = toolSwapStore.value;
            if (swap && swap.lastDownKey === key && swap.lastDownTime !== null && swap.previousTool !== null) {
                const duration = performance.now() - swap.lastDownTime;
                if (duration > 300) {
                    setEditingTool(swap.previousTool);
                }
                toolSwapStore.set({ lastDownTime: null, lastDownKey: null, previousTool: null });
            }
        }
);
