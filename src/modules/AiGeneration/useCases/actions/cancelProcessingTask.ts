import { aiStore, getAiSnapshot, type AiTaskType } from '../../stores/aiStore';

/**
 * Force-fail all tasks of the given type that are stuck in 'processing'.
 *
 * This is a UI-only escape hatch — the underlying async operation (network
 * request, model inference) may still be running. If it completes after this
 * call, the task will be updated to 'success' or 'error' by the handler.
 * This is intentional: a late success is better than a permanently blocked UI.
 */
export function cancelProcessingTask(type: AiTaskType): void {
    const snapshot = getAiSnapshot();
    aiStore.set({
        ...snapshot,
        tasks: snapshot.tasks.map((time) =>
            time.type === type && time.status === 'processing'
                ? { ...time, status: 'error' as const, error: 'Stopped by user' }
                : time
        ),
    });
}
