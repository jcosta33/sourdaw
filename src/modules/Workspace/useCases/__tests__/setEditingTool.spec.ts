import { describe, it, expect, vi } from 'vitest';
import { setEditingTool } from '../setEditingTool';
import { getWorkspaceState, updateWorkspaceState } from '../../repositories/workspace';
import { defaultWorkspaceState } from '../../models/WorkspaceState';

vi.mock('../../repositories/workspace', () => ({
    getWorkspaceState: vi.fn(),
    updateWorkspaceState: vi.fn(),
}));

describe('setEditingTool', () => {
    it('should not update when workspace state is missing', () => {
        vi.mocked(getWorkspaceState).mockReturnValue(null as any);

        setEditingTool('draw');

        expect(updateWorkspaceState).not.toHaveBeenCalled();
    });

    it('should patch activeTool when state exists', () => {
        vi.mocked(getWorkspaceState).mockReturnValue({ ...defaultWorkspaceState } as any);

        setEditingTool('stretch');

        expect(updateWorkspaceState).toHaveBeenCalledWith({ activeTool: 'stretch' });
    });
});
