import { describe, it, expect, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    updateWorkspaceState: vi.fn(),
}));

vi.mock('../../../../repositories/getWorkspaceState', () => ({
    getWorkspaceState: () => null,
}));
vi.mock('../../../../repositories/updateWorkspaceState', () => ({
    updateWorkspaceState: mocks.updateWorkspaceState,
}));

import { setSessionViewWidth } from '#/modules/WorkspaceShell/useCases/togglePanel/panelToggles';

describe('setSessionViewWidth', () => {
    it('should update sessionViewWidth', () => {
        setSessionViewWidth(500);
        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({ sessionViewWidth: 500 });
    });
});
