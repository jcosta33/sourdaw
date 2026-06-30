import { aiStore, type AiTaskResult } from '../../stores/aiStore';

export function removeTask(id: string) {
    aiStore.update((current) => {
        const state = current ?? { tasks: [], isPanelOpen: false };
        return {
            ...state,
            tasks: state.tasks.filter((task: AiTaskResult) => task.id !== id),
        };
    });
}
