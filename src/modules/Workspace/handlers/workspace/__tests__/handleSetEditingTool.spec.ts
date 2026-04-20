import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleSetEditingTool } from '../handleSetEditingTool';

const mocks = vi.hoisted(() => ({
    setEditingTool: vi.fn(),
}));

vi.mock('../../../useCases/setEditingTool', () => ({
    setEditingTool: mocks.setEditingTool,
}));

describe('handleSetEditingTool', () => {
    beforeEach(() => vi.clearAllMocks());

    it('delegates to setEditingTool use case', () => {
        handleSetEditingTool.execute({
            type: 'setEditingTool',
            payload: { tool: 'cut' },
        });
        expect(mocks.setEditingTool).toHaveBeenCalledWith('cut');
    });
});
