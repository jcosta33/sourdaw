import { describe, it, expect, vi } from 'vitest';
import { setSessionViewWidth } from '#/modules/Workspace/useCases/togglePanel/panelToggles';
import { updateWorkspaceState } from '#/modules/Workspace/useCases/workspaceState';

vi.mock('#/modules/Workspace/useCases/workspaceState', () => ({
    updateWorkspaceState: vi.fn(),
}));

describe('setSessionViewWidth', () => {
    it('should update sessionViewWidth', () => {
        setSessionViewWidth(500);
        expect(vi.mocked(updateWorkspaceState)).toHaveBeenCalledWith({ sessionViewWidth: 500 });
    });
});
