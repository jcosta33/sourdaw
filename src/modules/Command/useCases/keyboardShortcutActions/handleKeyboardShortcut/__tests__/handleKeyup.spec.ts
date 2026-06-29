import { describe, it, expect, vi, beforeEach } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { toolSwapStore } from '#/modules/Workspace/stores';
import { setEditingTool } from '#/modules/Workspace/useCases';

import { handleKeyup } from '../handleKeyup';

const eventBus = { emit: vi.fn(), on: vi.fn(() => () => undefined) };

vi.mock('#/modules/Workspace/stores', () => ({
    toolSwapStore: { value: null, set: vi.fn() },
}));

vi.mock('#/modules/Workspace/useCases', () => ({
    setEditingTool: vi.fn(),
}));

describe('handleKeyup', () => {
    beforeEach(() => {
        injectDependencies(handleKeyup, { eventBus });
        vi.clearAllMocks();
        vi.mocked(toolSwapStore).value = null;
    });

    it('emits voice.toggle inactive on releasing v', () => {
        handleKeyup('v');

        expect(eventBus.emit).toHaveBeenCalledWith('voice.toggle', { active: false });
    });

    it('restores the previous tool when a hold-swap key is released after 300ms', () => {
        vi.mocked(toolSwapStore).value = {
            lastDownKey: 'b',
            lastDownTime: performance.now() - 500,
            previousTool: 'select',
        };

        handleKeyup('b');

        expect(setEditingTool).toHaveBeenCalledWith('select');
        expect(toolSwapStore.set).toHaveBeenCalledWith({
            lastDownTime: null,
            lastDownKey: null,
            previousTool: null,
        });
    });

    it('does not restore the tool for a quick tap under 300ms', () => {
        vi.mocked(toolSwapStore).value = {
            lastDownKey: 'b',
            lastDownTime: performance.now() - 50,
            previousTool: 'select',
        };

        handleKeyup('b');

        expect(setEditingTool).not.toHaveBeenCalled();
        expect(toolSwapStore.set).toHaveBeenCalledWith({
            lastDownTime: null,
            lastDownKey: null,
            previousTool: null,
        });
    });

    it('ignores a release for a key that is not the tracked hold key', () => {
        vi.mocked(toolSwapStore).value = {
            lastDownKey: 'b',
            lastDownTime: performance.now() - 500,
            previousTool: 'select',
        };

        handleKeyup('e');

        expect(setEditingTool).not.toHaveBeenCalled();
        expect(toolSwapStore.set).not.toHaveBeenCalled();
    });
});
