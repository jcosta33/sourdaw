import { describe, it, expect, vi } from 'vitest';

import { defaultWorkspaceState } from '../../models/WorkspaceState';
import { getWorkspaceState } from '../../repositories/getWorkspaceState';
import { updateWorkspaceState } from '../../repositories/updateWorkspaceState';
import { setWorkspaceMode } from '../setWorkspaceMode';

vi.mock('../../repositories/getWorkspaceState', () => ({
    getWorkspaceState: vi.fn(),
}));
vi.mock('../../repositories/updateWorkspaceState', () => ({
    updateWorkspaceState: vi.fn(),
}));

describe('setWorkspaceMode', () => {
    it('should not update when workspace state is missing', () => {
        vi.mocked(getWorkspaceState).mockReturnValue(null as any);

        setWorkspaceMode('clip');

        expect(updateWorkspaceState).not.toHaveBeenCalled();
    });

    it('should patch mode when state exists', () => {
        vi.mocked(getWorkspaceState).mockReturnValue({ ...defaultWorkspaceState });

        setWorkspaceMode('automation');

        expect(updateWorkspaceState).toHaveBeenCalledWith({ mode: 'automation' });
    });
});
