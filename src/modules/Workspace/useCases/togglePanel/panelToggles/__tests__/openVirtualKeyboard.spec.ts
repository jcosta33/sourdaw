import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    updateWorkspaceState: vi.fn(),
}));

vi.mock('../../../../repositories/updateWorkspaceState', () => ({
    updateWorkspaceState: mocks.updateWorkspaceState,
}));

import { openVirtualKeyboard } from '../openVirtualKeyboard';

describe('openVirtualKeyboard', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('opens the virtual keyboard', () => {
        openVirtualKeyboard();

        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({ virtualKeyboardOpen: true });
    });
});
