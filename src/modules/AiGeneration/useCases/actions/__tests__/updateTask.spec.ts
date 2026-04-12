import { describe, it, expect, beforeEach } from 'vitest';
import { updateTask } from '../updateTask';
import { aiStore } from '../../../stores/aiStore';

describe('updateTask', () => {
    beforeEach(() => {
        aiStore.set({
            tasks: [
                { id: 't1', type: 'audio-generation', status: 'processing', timestamp: 1 },
                { id: 't2', type: 'midi-generation', status: 'processing', timestamp: 2 },
            ],
            isPanelOpen: false,
        });
    });

    it('updates properties of an existing task', () => {
        updateTask('t1', { status: 'success', data: { some: 'data' } });
        
        expect(aiStore.value!.tasks[0]).toEqual({
            id: 't1',
            type: 'audio-generation',
            status: 'success',
            timestamp: 1,
            data: { some: 'data' },
        });
        // other tasks untouched
        expect(aiStore.value!.tasks[1]!.status).toBe('processing');
    });

    it('does nothing if the task is not found', () => {
        updateTask('missing', { status: 'error' });
        
        expect(aiStore.value!.tasks[0]!.status).toBe('processing');
        expect(aiStore.value!.tasks[1]!.status).toBe('processing');
    });
});
