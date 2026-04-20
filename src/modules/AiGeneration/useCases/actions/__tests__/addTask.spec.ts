import { describe, it, expect, beforeEach, vi } from 'vitest';

import { aiStore } from '../../../stores/aiStore';
import { addTask } from '../addTask';

describe('addTask', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(1000);
        aiStore.set({ tasks: [], isPanelOpen: false });
    });

    it('adds a new task with generated id and timestamp', () => {
        const id = addTask({ type: 'audio-generation', status: 'processing' });

        expect(id).toMatch(/^ai-task-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
        expect(aiStore.value!.tasks).toHaveLength(1);
        expect(aiStore.value!.tasks[0]).toEqual({
            id,
            type: 'audio-generation',
            status: 'processing',
            timestamp: 1000,
        });
    });

    it('limits the task list to 50 items', () => {
        const existingTasks = Array.from({ length: 50 }, (_, i) => ({
            id: `task-${i}`,
            type: 'midi-generation' as const,
            status: 'success' as const,
            timestamp: 0,
        }));
        aiStore.set({ tasks: existingTasks, isPanelOpen: false });

        addTask({ type: 'audio-generation', status: 'processing' });

        expect(aiStore.value!.tasks).toHaveLength(50);
        expect(aiStore.value!.tasks[0]!.type).toBe('audio-generation');
        expect(aiStore.value!.tasks[49]!.id).toBe('task-48');
    });
});
