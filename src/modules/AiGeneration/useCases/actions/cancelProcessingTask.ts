import { aiStore, type AiTaskType } from '../../stores/aiStore';

/**
 * Force-fail all tasks of the given type that are stuck in 'processing'.
 *
 * Provider inference may still be running when its transport cannot be aborted,
 * but generation write paths treat the processing status as execution authority.
 * Once this marks a task stopped, a result that has not committed loses write
 * authority. If the commit already landed, the generation path replaces the
 * optimistic stop receipt with the truthful committed result.
 */
export function cancelProcessingTask(type: AiTaskType): void {
    aiStore.update((current) => {
        const state = current ?? { tasks: [], isPanelOpen: false };
        return {
            ...state,
            tasks: state.tasks.map((task) =>
                task.type === type && task.status === 'processing'
                    ? { ...task, status: 'error' as const, error: 'Stopped by user' }
                    : task
            ),
        };
    });
}
