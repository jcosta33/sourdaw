import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { aiStore } from '../../../stores/aiStore';
import { removeTask } from '../removeTask';

describe('removeTask', () => {
    beforeEach(() => {
        aiStore.set({
            tasks: [
                { id: 't1', type: 'denoise', status: 'success', timestamp: 1 },
                { id: 't2', type: 'midi-generation', status: 'processing', timestamp: 2 },
            ],
            isPanelOpen: false,
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('removes the specified task by id', () => {
        removeTask('t1');

        expect(aiStore.value!.tasks).toHaveLength(1);
        expect(aiStore.value!.tasks[0]!.id).toBe('t2');
    });

    it('preserves an unrelated current task when a stale snapshot is observed', () => {
        vi.spyOn(aiStore, 'value', 'get').mockReturnValueOnce({
            tasks: [{ id: 't1', type: 'denoise', status: 'success', timestamp: 1 }],
            isPanelOpen: false,
        });

        removeTask('t1');

        expect(aiStore.getSnapshot()!.tasks).toEqual([
            { id: 't2', type: 'midi-generation', status: 'processing', timestamp: 2 },
        ]);
    });

    it('does nothing if the task is not found', () => {
        removeTask('missing');

        expect(aiStore.value!.tasks).toHaveLength(2);
    });
});
