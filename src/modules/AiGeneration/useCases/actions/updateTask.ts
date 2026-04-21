import { aiStore, getAiSnapshot, type AiTaskResult } from '../../stores/aiStore';

export function updateTask(id: string, updates: Partial<AiTaskResult>) {
    const snapshot = getAiSnapshot();
    aiStore.set({
        ...snapshot,
        tasks: snapshot.tasks.map((time: AiTaskResult) => (time.id === id ? { ...time, ...updates } : time)),
    });
}
