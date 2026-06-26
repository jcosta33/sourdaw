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
        const existingTasks = Array.from({ length: 50 }, (_, index) => ({
            id: `task-${index}`,
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

    it('never evicts an in-flight (processing) task when capping at 50', () => {
        // An older still-processing task at the bottom of the list, then 50
        // newer finished tasks prepended on top of it. A plain slice(0, 50)
        // would drop the processing row off the bottom; the cap must keep it.
        aiStore.set({
            tasks: [
                {
                    id: 'inflight',
                    type: 'midi-generation',
                    status: 'processing',
                    timestamp: 0,
                },
            ],
            isPanelOpen: false,
        });

        for (let index = 0; index < 50; index++) {
            addTask({ type: 'audio-generation', status: 'success' });
        }

        const tasks = aiStore.value!.tasks;
        expect(tasks).toHaveLength(50);
        expect(tasks.some((task) => task.id === 'inflight')).toBe(true);
        // The oldest finished task is dropped to make room, not the processing one.
        const inflight = tasks.find((task) => task.id === 'inflight');
        expect(inflight!.status).toBe('processing');
    });

    it('keeps newest-first order and matches a plain slice when nothing is processing', () => {
        const existingTasks = Array.from({ length: 55 }, (_, index) => ({
            id: `task-${index}`,
            type: 'audio-generation' as const,
            status: 'success' as const,
            timestamp: 0,
        }));
        aiStore.set({ tasks: existingTasks, isPanelOpen: false });

        addTask({ type: 'midi-generation', status: 'success' });

        const tasks = aiStore.value!.tasks;
        expect(tasks).toHaveLength(50);
        expect(tasks[0]!.type).toBe('midi-generation');
        // task-49..task-54 (the 6 oldest beyond the cap) are dropped.
        expect(tasks.some((task) => task.id === 'task-49')).toBe(false);
        expect(tasks[49]!.id).toBe('task-48');
    });
});
