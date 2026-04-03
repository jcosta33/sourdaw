import { aiStore, getAiSnapshot, type AiTaskResult } from '../../stores/aiStore';

export const removeTask = (id: string) => {
    const s = getAiSnapshot();
    aiStore.set({
        ...s,
        tasks: s.tasks.filter((t: AiTaskResult) => t.id !== id),
    });
};
