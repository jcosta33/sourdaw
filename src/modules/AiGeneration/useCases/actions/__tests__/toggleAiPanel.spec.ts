import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { aiStore } from '../../../stores/aiStore';
import { toggleAiPanel } from '../toggleAiPanel';

describe('toggleAiPanel', () => {
    beforeEach(() => {
        aiStore.set({ tasks: [], isPanelOpen: false });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('toggles the panel open state', () => {
        expect(aiStore.value!.isPanelOpen).toBe(false);

        toggleAiPanel();
        expect(aiStore.value!.isPanelOpen).toBe(true);

        toggleAiPanel();
        expect(aiStore.value!.isPanelOpen).toBe(false);
    });

    it('preserves current tasks when a stale snapshot is observed', () => {
        aiStore.set({
            tasks: [{ id: 'current-task', type: 'midi-generation', status: 'processing', timestamp: 1 }],
            isPanelOpen: false,
        });
        vi.spyOn(aiStore, 'value', 'get').mockReturnValueOnce({ tasks: [], isPanelOpen: false });

        toggleAiPanel();

        expect(aiStore.getSnapshot()).toEqual({
            tasks: [{ id: 'current-task', type: 'midi-generation', status: 'processing', timestamp: 1 }],
            isPanelOpen: true,
        });
    });
});
