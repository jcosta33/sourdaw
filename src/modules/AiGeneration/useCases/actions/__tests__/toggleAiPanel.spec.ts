import { describe, it, expect, beforeEach } from 'vitest';

import { aiStore } from '../../../stores/aiStore';
import { toggleAiPanel } from '../toggleAiPanel';

describe('toggleAiPanel', () => {
    beforeEach(() => {
        aiStore.set({ tasks: [], isPanelOpen: false });
    });

    it('toggles the panel open state', () => {
        expect(aiStore.value!.isPanelOpen).toBe(false);

        toggleAiPanel();
        expect(aiStore.value!.isPanelOpen).toBe(true);

        toggleAiPanel();
        expect(aiStore.value!.isPanelOpen).toBe(false);
    });
});
