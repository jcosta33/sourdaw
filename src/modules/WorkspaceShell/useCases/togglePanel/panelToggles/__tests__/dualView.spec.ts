import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type WorkspaceState } from '#/modules/WorkspaceShell/models/WorkspaceState';
import { workspaceStore } from '#/modules/WorkspaceShell/stores/workspaceStore';
import { toggleDualView } from '#/modules/WorkspaceShell/useCases/togglePanel/panelToggles';

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

    it('should toggle dualViewOpen off when currently on', () => {
        workspaceStore.set({ dualViewOpen: true } as unknown as WorkspaceState);
        toggleDualView();
        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({ dualViewOpen: false });
    });

    it('is a no-op when workspace state is null (guard branch)', () => {
        workspaceStore.set(null);
        toggleDualView();
        expect(mocks.updateWorkspaceState).not.toHaveBeenCalled();
    });
});
