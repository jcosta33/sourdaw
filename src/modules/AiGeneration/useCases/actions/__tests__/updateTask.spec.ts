import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { aiStore } from '../../../stores/aiStore';
import { updateTask } from '../updateTask';

describe('updateTask', () => {
    beforeEach(() => {
        aiStore.set({
            tasks: [
                { id: 't1', type: 'denoise', status: 'processing', timestamp: 1 },
                { id: 't2', type: 'midi-generation', status: 'processing', timestamp: 2 },
            ],
            isPanelOpen: false,
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('updates properties of an existing task', () => {
        updateTask('t1', { status: 'success', data: { some: 'data' } });

        expect(aiStore.value!.tasks[0]).toEqual({
            id: 't1',
            type: 'denoise',
            status: 'success',
            timestamp: 1,
            data: { some: 'data' },
        });
        // other tasks untouched
        expect(aiStore.value!.tasks[1]!.status).toBe('processing');
    });

    it('preserves an unrelated current task when a stale snapshot is observed', () => {
        vi.spyOn(aiStore, 'value', 'get').mockReturnValueOnce({
            tasks: [{ id: 't1', type: 'denoise', status: 'processing', timestamp: 1 }],
            isPanelOpen: false,
        });

        updateTask('t1', { status: 'success' });

        expect(aiStore.getSnapshot()!.tasks).toEqual([
            { id: 't1', type: 'denoise', status: 'success', timestamp: 1 },
            { id: 't2', type: 'midi-generation', status: 'processing', timestamp: 2 },
        ]);
    });

    it('does not resurrect a removed task when a late update observes a stale snapshot', () => {
        aiStore.set({
            tasks: [{ id: 't2', type: 'midi-generation', status: 'processing', timestamp: 2 }],
            isPanelOpen: false,
        });
        vi.spyOn(aiStore, 'value', 'get').mockReturnValueOnce({
            tasks: [
                { id: 't1', type: 'denoise', status: 'processing', timestamp: 1 },
                { id: 't2', type: 'midi-generation', status: 'processing', timestamp: 2 },
            ],
            isPanelOpen: false,
        });

        updateTask('t1', { status: 'success' });

        expect(aiStore.getSnapshot()!.tasks).toEqual([
            { id: 't2', type: 'midi-generation', status: 'processing', timestamp: 2 },
        ]);
    });

    it('does nothing if the task is not found', () => {
        updateTask('missing', { status: 'error' });

        expect(aiStore.value!.tasks[0]!.status).toBe('processing');
        expect(aiStore.value!.tasks[1]!.status).toBe('processing');
    });
});
