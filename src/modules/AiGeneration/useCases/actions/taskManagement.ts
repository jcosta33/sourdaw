import { aiStore, getAiSnapshot, type AiTaskResult } from '../../stores/aiStore';

export const toggleAiPanel = () => {
    const s = getAiSnapshot();
    aiStore.set({ ...s, isPanelOpen: !s.isPanelOpen });
};

export const addTask = (task: Omit<AiTaskResult, 'id' | 'timestamp'>): string => {
    const id = `ai-task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const fullTask: AiTaskResult = { ...task, id, timestamp: Date.now() };
    const s = getAiSnapshot();
    aiStore.set({ ...s, tasks: [fullTask, ...s.tasks].slice(0, 50) });
    return id;
};

export const updateTask = (id: string, updates: Partial<AiTaskResult>) => {
    const s = getAiSnapshot();
    aiStore.set({
        ...s,
        tasks: s.tasks.map((t: AiTaskResult) => (t.id === id ? { ...t, ...updates } : t)),
    });
};

export const removeTask = (id: string) => {
    const s = getAiSnapshot();
    aiStore.set({
        ...s,
        tasks: s.tasks.filter((t: AiTaskResult) => t.id !== id),
    });
};
