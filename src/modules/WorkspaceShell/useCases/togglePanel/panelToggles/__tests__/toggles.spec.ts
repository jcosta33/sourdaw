import { describe, it, expect, vi, beforeEach } from 'vitest';

import { setSnapValue } from '../setSnapValue';
import { toggleInspector } from '../toggleInspector';
import { toggleMixer } from '../toggleMixer';
import { toggleSidebar } from '../toggleSidebar';

const mocks = vi.hoisted(() => ({
    getWorkspaceState: vi.fn(),
    updateWorkspaceState: vi.fn(),
}));

vi.mock('../../../../repositories/getWorkspaceState', () => ({
    getWorkspaceState: mocks.getWorkspaceState,
}));
vi.mock('../../../../repositories/updateWorkspaceState', () => ({
    updateWorkspaceState: mocks.updateWorkspaceState,
}));

describe('Workspace Toggles', () => {
    beforeEach(() => vi.clearAllMocks());

    it('toggleInspector toggles inspector state', () => {
        mocks.getWorkspaceState.mockReturnValue({ inspectorOpen: false });
        toggleInspector();
        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({ inspectorOpen: true });

        mocks.getWorkspaceState.mockReturnValue({ inspectorOpen: true });
        toggleInspector();
        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({ inspectorOpen: false });
    });

    it('toggleSidebar toggles sidebar state', () => {
        mocks.getWorkspaceState.mockReturnValue({ sidebarOpen: false });
        toggleSidebar();
        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({ sidebarOpen: true });
    });

    it('toggleMixer toggles mixer state', () => {
        mocks.getWorkspaceState.mockReturnValue({ mixerOpen: false });
        toggleMixer();
        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({ mixerOpen: true });
    });

    it('setSnapValue updates snap setting', () => {
        mocks.getWorkspaceState.mockReturnValue({});
        setSnapValue(0.25);
        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({ snapValue: 0.25 });
    });
});
