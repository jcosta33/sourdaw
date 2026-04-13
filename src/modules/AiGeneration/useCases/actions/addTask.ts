import { aiStore, getAiSnapshot, type AiTaskResult } from '../../stores/aiStore';

export function addTask(task: Omit<AiTaskResult, 'id' | 'timestamp'>): string {
    const id = `ai-task-${crypto.randomUUID()}`;

    const fullTask: AiTaskResult = { ...task, id, timestamp: Date.now() };
    const snapshot = getAiSnapshot();

    aiStore.set({ ...snapshot, tasks: [fullTask, ...snapshot.tasks].slice(0, 50) });

    return id;
}
