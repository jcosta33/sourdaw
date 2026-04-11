import { aiStore, getAiSnapshot, type AiTaskResult } from '../../stores/aiStore';

export function updateTask(id: string, updates: Partial<AiTaskResult>) {
    const snapshot = getAiSnapshot();
    aiStore.set({
        ...snapshot,
        tasks: snapshot.tasks.map((t: AiTaskResult) => (t.id === id ? { ...t, ...updates } : t)),
    });
}
