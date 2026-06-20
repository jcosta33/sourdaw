import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type WorkspaceState } from '#/modules/Workspace/models/WorkspaceState';
import { workspaceStore } from '#/modules/Workspace/stores/workspaceStore';
import { toggleDualView } from '#/modules/Workspace/useCases/togglePanel/panelToggles';

const mocks = vi.hoisted(() => ({
    updateWorkspaceState: vi.fn<(...args: unknown[]) => void>(),
}));

vi.mock('../../../../repositories/getWorkspaceState', () => ({
    getWorkspaceState: () => workspaceStore.value,
}));
vi.mock('../../../../repositories/updateWorkspaceState', () => ({
    updateWorkspaceState: mocks.updateWorkspaceState,
}));

describe('toggleDualView', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should toggle dualViewOpen state', () => {
        workspaceStore.set({ dualViewOpen: false } as unknown as WorkspaceState);
        toggleDualView();
        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({ dualViewOpen: true });
    });
});
