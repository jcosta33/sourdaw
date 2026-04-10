import { inject } from '#/infra/di/inject';
import { aiStore, getAiSnapshot, type AiTaskResult } from '../../stores/aiStore';

export const updateTask = inject({ aiStore, getAiSnapshot })(
    ({ aiStore, getAiSnapshot }) =>
        function updateTask(id: string, updates: Partial<AiTaskResult>) {
            const snapshot = getAiSnapshot();
            aiStore.set({
                ...snapshot,
                tasks: snapshot.tasks.map((t: AiTaskResult) => (t.id === id ? { ...t, ...updates } : t)),
            });
        }
);
