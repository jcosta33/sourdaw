import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { WorkspaceState } from '../../../../models/WorkspaceState';
import { toggleSidebar } from '../toggleSidebar';

const mocks = vi.hoisted(() => ({
    getWorkspaceState: vi.fn<() => Partial<WorkspaceState> | null>(),
    updateWorkspaceState: vi.fn(),
}));

vi.mock('../../../../repositories/workspace', () => ({
    getWorkspaceState: mocks.getWorkspaceState,
    updateWorkspaceState: mocks.updateWorkspaceState,
}));

describe('toggleSidebar', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('does not update workspace when state is missing', () => {
        mocks.getWorkspaceState.mockReturnValue(null);

        toggleSidebar();

        expect(mocks.updateWorkspaceState).not.toHaveBeenCalled();
    });

    it('flips sidebarOpen when state exists', () => {
        mocks.getWorkspaceState.mockReturnValue({ sidebarOpen: true });

        toggleSidebar();

        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({ sidebarOpen: false });
    });

    it('can open the sidebar when it was closed', () => {
        mocks.getWorkspaceState.mockReturnValue({ sidebarOpen: false } as any);

        toggleSidebar();

        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({ sidebarOpen: true });
    });
});
