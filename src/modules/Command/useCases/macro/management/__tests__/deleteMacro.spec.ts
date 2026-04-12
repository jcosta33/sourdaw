import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { type Macro } from '../../../../models/Macro';
import { macroStore } from '../../../../stores/macroStore';
import { deleteMacro } from '../deleteMacro';

const STORAGE_KEY = 'sourdaw:macros';

describe('deleteMacro', () => {
    const m1: Macro = { id: 'a', name: 'A', actions: [], createdAt: 1 };
    const m2: Macro = { id: 'b', name: 'B', actions: [], createdAt: 2 };

    beforeEach(() => {
        localStorage.removeItem(STORAGE_KEY);
        macroStore.set({ macros: [m1, m2], recording: false, currentRecording: [] });
    });

    afterEach(() => {
        localStorage.removeItem(STORAGE_KEY);
    });

    it('should remove the macro with the given id', () => {
        deleteMacro('a');

        expect(macroStore.value?.macros).toHaveLength(1);
        expect(macroStore.value?.macros[0]?.id).toBe('b');
    });

    it('should not mutate when macroStore value is null', () => {
        macroStore.set(null);
        deleteMacro('a');
        expect(macroStore.value).toBeNull();
    });
});
