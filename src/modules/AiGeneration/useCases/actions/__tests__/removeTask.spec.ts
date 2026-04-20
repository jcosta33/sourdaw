import { describe, it, expect, beforeEach } from 'vitest';

import { aiStore } from '../../../stores/aiStore';
import { removeTask } from '../removeTask';

describe('removeTask', () => {
    beforeEach(() => {
        aiStore.set({
            tasks: [
                { id: 't1', type: 'audio-generation', status: 'success', timestamp: 1 },
                { id: 't2', type: 'midi-generation', status: 'processing', timestamp: 2 },
            ],
            isPanelOpen: false,
        });
    });

    it('removes the specified task by id', () => {
        removeTask('t1');

        expect(aiStore.value!.tasks).toHaveLength(1);
        expect(aiStore.value!.tasks[0]!.id).toBe('t2');
    });

    it('does nothing if the task is not found', () => {
        removeTask('missing');

        expect(aiStore.value!.tasks).toHaveLength(2);
    });
});
