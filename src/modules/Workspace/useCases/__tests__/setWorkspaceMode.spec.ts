import { describe, it, expect, vi } from 'vitest';

import { defaultWorkspaceState } from '../../models/WorkspaceState';
import { getWorkspaceState, updateWorkspaceState } from '../../repositories/workspace';
import { setWorkspaceMode } from '../setWorkspaceMode';

vi.mock('../../repositories/workspace', () => ({
    getWorkspaceState: vi.fn(),
    updateWorkspaceState: vi.fn(),
}));

describe('setWorkspaceMode', () => {
    it('should not update when workspace state is missing', () => {
        vi.mocked(getWorkspaceState).mockReturnValue(null as any);

        setWorkspaceMode('clip');

        expect(updateWorkspaceState).not.toHaveBeenCalled();
    });

    it('should patch mode when state exists', () => {
        vi.mocked(getWorkspaceState).mockReturnValue({ ...defaultWorkspaceState } as any);

        setWorkspaceMode('automation');

        expect(updateWorkspaceState).toHaveBeenCalledWith({ mode: 'automation' });
    });
});
