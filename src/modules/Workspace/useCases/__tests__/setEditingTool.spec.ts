import { describe, it, expect, vi } from 'vitest';

import { setEditingTool } from '../setEditingTool';

const mocks = vi.hoisted(() => ({
    getWorkspaceState: vi.fn(),
    updateWorkspaceState: vi.fn(),
}));

vi.mock('../../repositories/workspace', () => ({
    getWorkspaceState: mocks.getWorkspaceState,
    updateWorkspaceState: mocks.updateWorkspaceState,
}));

describe('setEditingTool', () => {
    it('updates active tool in workspace state', () => {
        mocks.getWorkspaceState.mockReturnValue({});
        setEditingTool('cut');
        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({ activeTool: 'cut' });
    });
});
