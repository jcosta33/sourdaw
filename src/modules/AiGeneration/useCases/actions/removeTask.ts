import { inject } from '#/infra/di/inject';
import { aiStore, getAiSnapshot, type AiTaskResult } from '../../stores/aiStore';

export const removeTask = inject({ aiStore, getAiSnapshot })(
    ({ aiStore, getAiSnapshot }) =>
        function removeTask(id: string) {
            const snapshot = getAiSnapshot();
            aiStore.set({
                ...snapshot,
                tasks: snapshot.tasks.filter((t: AiTaskResult) => t.id !== id),
            });
        }
);
