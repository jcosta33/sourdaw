import { aiStore, type AiTaskResult } from '../../stores/aiStore';

export function updateTask(id: string, updates: Partial<AiTaskResult>) {
    aiStore.update((current) => {
        const state = current ?? { tasks: [], isPanelOpen: false };
        return {
            ...state,
            tasks: state.tasks.map((task: AiTaskResult) => (task.id === id ? { ...task, ...updates } : task)),
        };
    });
}
