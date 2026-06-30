import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { aiStore } from '../../../stores/aiStore';
import { cancelProcessingTask } from '../cancelProcessingTask';

describe('cancelProcessingTask', () => {
    beforeEach(() => {
        aiStore.set({
            tasks: [
                { id: 't1', type: 'audio-generation', status: 'processing', timestamp: 1 },
                { id: 't2', type: 'audio-generation', status: 'success', timestamp: 2 },
                { id: 't3', type: 'midi-generation', status: 'processing', timestamp: 3 },
            ],
            isPanelOpen: false,
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('cancels only matching processing tasks', () => {
        cancelProcessingTask('audio-generation');

        expect(aiStore.getSnapshot()!.tasks).toEqual([
            {
                id: 't1',
                type: 'audio-generation',
                status: 'error',
                timestamp: 1,
                error: 'Stopped by user',
            },
            { id: 't2', type: 'audio-generation', status: 'success', timestamp: 2 },
            { id: 't3', type: 'midi-generation', status: 'processing', timestamp: 3 },
        ]);
    });

    it('preserves an unrelated current task when a stale snapshot is observed', () => {
        vi.spyOn(aiStore, 'value', 'get').mockReturnValueOnce({
            tasks: [{ id: 't1', type: 'audio-generation', status: 'processing', timestamp: 1 }],
            isPanelOpen: false,
        });

        cancelProcessingTask('audio-generation');

        expect(aiStore.getSnapshot()!.tasks).toEqual([
            {
                id: 't1',
                type: 'audio-generation',
                status: 'error',
                timestamp: 1,
                error: 'Stopped by user',
            },
            { id: 't2', type: 'audio-generation', status: 'success', timestamp: 2 },
            { id: 't3', type: 'midi-generation', status: 'processing', timestamp: 3 },
        ]);
    });
});
