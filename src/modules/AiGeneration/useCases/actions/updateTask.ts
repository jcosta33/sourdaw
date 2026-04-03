import { aiStore, getAiSnapshot, type AiTaskResult } from '../../stores/aiStore';

export const updateTask = (id: string, updates: Partial<AiTaskResult>) => {
    const s = getAiSnapshot();
    aiStore.set({
        ...s,
        tasks: s.tasks.map((t: AiTaskResult) => (t.id === id ? { ...t, ...updates } : t)),
    });
};
