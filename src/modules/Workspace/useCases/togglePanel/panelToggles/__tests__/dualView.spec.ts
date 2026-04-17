import { describe, it, expect, vi, beforeEach } from 'vitest';
import { workspaceStore } from '#/modules/Workspace/stores/workspaceStore';

describe('toggleDualView', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
    });

    it('should toggle dualViewOpen state', async () => {
        const mockUpdate = vi.fn();
        vi.doMock('#/modules/Workspace/useCases/workspaceState', () => ({
            updateWorkspaceState: mockUpdate,
        }));
        
        // Use relative path to match the factory's closure if needed
        vi.doMock('../../workspaceState', () => ({
            updateWorkspaceState: mockUpdate,
        }));

        const { toggleDualView } = await import('#/modules/Workspace/useCases/togglePanel/panelToggles');
        
        workspaceStore.set({ dualViewOpen: false } as any);
        toggleDualView();
        
        expect(mockUpdate).toHaveBeenCalledWith({ dualViewOpen: true });
    });
});
