import { aiStore, getAiSnapshot, type AiTaskResult } from '../../stores/aiStore';

/** Maximum number of task rows kept in the history. */
const MAX_TASKS = 50;

/**
 * Trim the task history to {@link MAX_TASKS}, newest-first, but NEVER evict a
 * task that is still `processing`. A plain `.slice(0, MAX_TASKS)` caps by
 * prepend order alone, so an in-flight task can be sliced off the bottom once
 * 50 newer tasks accumulate — its later terminal `updateTask` then targets a
 * row that no longer exists and is silently dropped. Keeping all `processing`
 * tasks plus the newest finished ones (in original order) closes that gap while
 * staying identical to the old slice when nothing is in flight.
 */
function capTasks(tasks: AiTaskResult[]): AiTaskResult[] {
    if (tasks.length <= MAX_TASKS) {
        return tasks;
    }

    const processing = tasks.filter((task) => task.status === 'processing');
    if (processing.length >= MAX_TASKS) {
        return processing;
    }

    const finishedKept = tasks.filter((task) => task.status !== 'processing').slice(0, MAX_TASKS - processing.length);
    const keep = new Set<AiTaskResult>([...processing, ...finishedKept]);
    return tasks.filter((task) => keep.has(task));
}

export function addTask(task: Omit<AiTaskResult, 'id' | 'timestamp'>): string {
    const id = `ai-task-${crypto.randomUUID()}`;

    const fullTask: AiTaskResult = { ...task, id, timestamp: Date.now() };
    const snapshot = getAiSnapshot();

    aiStore.set({ ...snapshot, tasks: capTasks([fullTask, ...snapshot.tasks]) });

    return id;
}
