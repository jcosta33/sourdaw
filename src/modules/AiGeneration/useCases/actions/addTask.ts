import { aiStore, getAiSnapshot, type AiTaskResult } from '../../stores/aiStore';

export const addTask = (task: Omit<AiTaskResult, 'id' | 'timestamp'>): string => {
    const id = `ai-task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const fullTask: AiTaskResult = { ...task, id, timestamp: Date.now() };
    const s = getAiSnapshot();
    aiStore.set({ ...s, tasks: [fullTask, ...s.tasks].slice(0, 50) });
    return id;
};
