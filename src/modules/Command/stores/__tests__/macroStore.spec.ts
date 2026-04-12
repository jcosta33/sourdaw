import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { type Macro } from '../../models/Macro';
import { macroStore } from '../macroStore';

const STORAGE_KEY = 'sourdaw:macros';

describe('macroStore', () => {
    beforeEach(() => {
        localStorage.removeItem(STORAGE_KEY);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
    });

    afterEach(() => {
        localStorage.removeItem(STORAGE_KEY);
    });

    it('should persist macros array to localStorage when state updates', () => {
        const macros: Macro[] = [
            { id: 'm1', name: 'Test macro', actions: [{ type: 'togglePlayback' }], createdAt: 42 },
        ];
        macroStore.set({ macros, recording: false, currentRecording: [] });

        const raw = localStorage.getItem(STORAGE_KEY);
        expect(raw).not.toBeNull();
        const parsed = JSON.parse(raw!) as Macro[];
        expect(parsed).toHaveLength(1);
        expect(parsed[0]?.name).toBe('Test macro');
        expect(parsed[0]?.id).toBe('m1');
    });

    it('should expose recording and currentRecording in state', () => {
        macroStore.set({ macros: [], recording: true, currentRecording: [{ type: 'stopPlayback' }] });

        expect(macroStore.value?.recording).toBe(true);
        expect(macroStore.value?.currentRecording).toEqual([{ type: 'stopPlayback' }]);
    });
});
