import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type WorkspaceState } from '../../../../models/WorkspaceState';
import { toggleVirtualKeyboard } from '../toggleVirtualKeyboard';

const mocks = vi.hoisted(() => ({
    getWorkspaceState: vi.fn<() => Partial<WorkspaceState> | null>(),
    updateWorkspaceState: vi.fn(),
}));

vi.mock('../../../../repositories/getWorkspaceState', () => ({
    getWorkspaceState: mocks.getWorkspaceState,
}));
vi.mock('../../../../repositories/updateWorkspaceState', () => ({
    updateWorkspaceState: mocks.updateWorkspaceState,
}));

describe('toggleVirtualKeyboard', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('does not update when workspace state is missing', () => {
        mocks.getWorkspaceState.mockReturnValue(null);

        toggleVirtualKeyboard();

        expect(mocks.updateWorkspaceState).not.toHaveBeenCalled();
    });

    it('opens the virtual keyboard when it was closed', () => {
        mocks.getWorkspaceState.mockReturnValue({ virtualKeyboardOpen: false });

        toggleVirtualKeyboard();

        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({ virtualKeyboardOpen: true });
    });

    it('closes the virtual keyboard when it was open', () => {
        mocks.getWorkspaceState.mockReturnValue({ virtualKeyboardOpen: true });

        toggleVirtualKeyboard();

        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({ virtualKeyboardOpen: false });
    });
});
