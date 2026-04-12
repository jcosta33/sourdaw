import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { type Macro } from '../../../../models/Macro';
import { macroStore } from '../../../../stores/macroStore';
import { renameMacro } from '../renameMacro';

const STORAGE_KEY = 'sourdaw:macros';

describe('renameMacro', () => {
    const macroA: Macro = {
        id: 'm-a',
        name: 'Old',
        actions: [{ type: 'togglePlayback' }],
        createdAt: 1,
    };

    beforeEach(() => {
        localStorage.removeItem(STORAGE_KEY);
        macroStore.set({ macros: [macroA], recording: false, currentRecording: [] });
    });

    afterEach(() => {
        localStorage.removeItem(STORAGE_KEY);
    });

    it('should update the macro name when id matches', () => {
        renameMacro('m-a', 'New');

        expect(macroStore.value?.macros[0]?.name).toBe('New');
        expect(macroStore.value?.macros[0]?.id).toBe('m-a');
    });

    it('should not mutate when macroStore value is null', () => {
        macroStore.set(null);
        renameMacro('m-a', 'X');
        expect(macroStore.value).toBeNull();
    });
});
