import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    updateWorkspaceState: vi.fn(),
}));

vi.mock('../../../../repositories/updateWorkspaceState', () => ({
    updateWorkspaceState: mocks.updateWorkspaceState,
}));

import { setVirtualKeyboardVelocity } from '../setVirtualKeyboardVelocity';

describe('setVirtualKeyboardVelocity', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('writes an in-range velocity unchanged', () => {
        setVirtualKeyboardVelocity(85);

        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({ virtualKeyboardVelocity: 85 });
    });

    it('clamps velocities below 1 up to 1', () => {
        setVirtualKeyboardVelocity(0);

        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({ virtualKeyboardVelocity: 1 });
    });

    it('clamps velocities above 127 down to 127', () => {
        setVirtualKeyboardVelocity(200);

        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({ virtualKeyboardVelocity: 127 });
    });
});
