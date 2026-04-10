import { inject } from '#/infra/di/inject';
import { aiStore, getAiSnapshot, type AiTaskResult } from '../../stores/aiStore';

export const addTask = inject({ aiStore, getAiSnapshot })(
    ({ aiStore, getAiSnapshot }) =>
        function addTask(task: Omit<AiTaskResult, 'id' | 'timestamp'>): string {
            const id = `ai-task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

            const fullTask: AiTaskResult = { ...task, id, timestamp: Date.now() };
            const snapshot = getAiSnapshot();

            aiStore.set({ ...snapshot, tasks: [fullTask, ...snapshot.tasks].slice(0, 50) });

            return id;
        }
);
