import { aiStore, getAiSnapshot, type AiTaskResult } from '../../stores/aiStore';

export function removeTask(id: string) {
    const snapshot = getAiSnapshot();
    aiStore.set({
        ...snapshot,
        tasks: snapshot.tasks.filter((t: AiTaskResult) => t.id !== id),
    });
}
