import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleSetEditingTool } from '../handleSetEditingTool';

const mocks = vi.hoisted(() => ({
    setEditingTool: vi.fn(),
    loggerWarn: vi.fn(),
}));

vi.mock('../../../useCases/setEditingTool', () => ({
    setEditingTool: mocks.setEditingTool,
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { warn: mocks.loggerWarn, error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const { loggerWarn } = mocks;

describe('handleSetEditingTool', () => {
    beforeEach(() => vi.clearAllMocks());

    it('delegates to setEditingTool use case', () => {
        void handleSetEditingTool.execute({
            type: 'setEditingTool',
            payload: { tool: 'cut' },
        });
        expect(mocks.setEditingTool).toHaveBeenCalledWith('cut');
    });

    it('accepts every declared editing tool', () => {
        const declaredTools = ['select', 'cut', 'draw', 'automation', 'stretch', 'marquee'];

        for (const tool of declaredTools) {
            void handleSetEditingTool.execute({ type: 'setEditingTool', payload: { tool } });
        }

        expect(mocks.setEditingTool).toHaveBeenCalledTimes(declaredTools.length);
        for (const [index, tool] of declaredTools.entries()) {
            expect(mocks.setEditingTool).toHaveBeenNthCalledWith(index + 1, tool);
        }
    });

    // The action payload is typed `{ tool: string }` and the AI validator marks it
    // 'unchecked', so an AI-originated bogus name used to be cast straight into
    // workspace state as the active tool.
    it('rejects a tool name that is not an EditingTool instead of writing it to state', () => {
        void handleSetEditingTool.execute({
            type: 'setEditingTool',
            payload: { tool: 'obliterate' },
        });

        expect(mocks.setEditingTool).not.toHaveBeenCalled();
        expect(loggerWarn).toHaveBeenCalledWith(
            '[WorkspaceShell] Ignoring setEditingTool with unknown tool: obliterate'
        );
    });

    it('describes the requested tool even when it is rejected', () => {
        expect(handleSetEditingTool.describe?.({ type: 'setEditingTool', payload: { tool: 'obliterate' } })).toEqual({
            label: 'Set tool: obliterate',
        });
    });
});
