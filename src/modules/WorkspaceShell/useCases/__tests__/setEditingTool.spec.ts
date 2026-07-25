import { describe, it, expect, vi } from 'vitest';

import { setEditingTool } from '../setEditingTool';

const mocks = vi.hoisted(() => ({
    getWorkspaceState: vi.fn(),
    updateWorkspaceState: vi.fn(),
}));

vi.mock('../../repositories/getWorkspaceState', () => ({
    getWorkspaceState: mocks.getWorkspaceState,
}));
vi.mock('../../repositories/updateWorkspaceState', () => ({
    updateWorkspaceState: mocks.updateWorkspaceState,
}));

describe('setEditingTool', () => {
    it('updates active tool in workspace state', () => {
        mocks.getWorkspaceState.mockReturnValue({});
        setEditingTool('cut');
        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({ activeTool: 'cut' });
    });

    it('is a no-op when workspace state is null (guard branch)', () => {
        mocks.getWorkspaceState.mockReturnValue(null);
        mocks.updateWorkspaceState.mockClear();

        setEditingTool('cut');

        expect(mocks.updateWorkspaceState).not.toHaveBeenCalled();
    });
});
