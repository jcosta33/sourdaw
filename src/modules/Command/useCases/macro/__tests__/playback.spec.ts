import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { type Macro } from '../../../models/Macro';
import { macroStore } from '../../../stores/macroStore';
import { playMacro } from '../playback';

const STORAGE_KEY = 'sourdaw:macros';

const { executeAppActionMock } = vi.hoisted(() => ({
    executeAppActionMock: vi
        .fn<typeof import('../../executeAppAction').executeAppAction>()
        .mockResolvedValue(undefined),
}));

vi.mock('../../executeAppAction', () => ({
    executeAppAction: executeAppActionMock,
}));

describe('playMacro', () => {
    const macro: Macro = {
        id: 'play-1',
        name: 'Two steps',
        actions: [{ type: 'togglePlayback' }, { type: 'toggleLoop' }],
        createdAt: 0,
    };

    beforeEach(() => {
        localStorage.removeItem(STORAGE_KEY);
        macroStore.set({ macros: [macro], recording: false, currentRecording: [] });
        executeAppActionMock.mockClear();
    });

    afterEach(() => {
        localStorage.removeItem(STORAGE_KEY);
    });

    it('should execute each action with a shared undo group', async () => {
        await playMacro('play-1');

        expect(executeAppActionMock).toHaveBeenCalledTimes(2);
        const [firstAction, firstOptions] = executeAppActionMock.mock.calls[0] as [
            import('../../executeAppAction').AppAction,
            import('../../executeAppAction').ExecuteOptions | undefined,
        ];
        const [secondAction, secondOptions] = executeAppActionMock.mock.calls[1] as [
            import('../../executeAppAction').AppAction,
            import('../../executeAppAction').ExecuteOptions | undefined,
        ];
        expect(firstAction).toEqual({ type: 'togglePlayback' });
        expect(secondAction).toEqual({ type: 'toggleLoop' });
        expect(firstOptions?.groupId).toBe(secondOptions?.groupId);
        expect(firstOptions?.groupLabel).toBe('Macro: Two steps');
    });

    it('should no-op when macro id is missing', async () => {
        await playMacro('missing');
        expect(executeAppActionMock).not.toHaveBeenCalled();
    });

    it('should no-op when macroStore value is null', async () => {
        macroStore.set(null);
        await playMacro('play-1');
        expect(executeAppActionMock).not.toHaveBeenCalled();
    });
});
