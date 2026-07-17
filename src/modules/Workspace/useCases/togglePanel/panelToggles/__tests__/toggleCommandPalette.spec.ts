import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type WorkspaceState } from '../../../../models/WorkspaceState';
import { toggleCommandPalette } from '../toggleCommandPalette';

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

describe('toggleCommandPalette', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('does not update when workspace state is missing', () => {
        mocks.getWorkspaceState.mockReturnValue(null);

        toggleCommandPalette();

        expect(mocks.updateWorkspaceState).not.toHaveBeenCalled();
    });

    it('opens the command palette when it was closed', () => {
        mocks.getWorkspaceState.mockReturnValue({ commandPaletteOpen: false });

        toggleCommandPalette();

        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({ commandPaletteOpen: true });
    });

    it('closes the command palette when it was open', () => {
        mocks.getWorkspaceState.mockReturnValue({ commandPaletteOpen: true });

        toggleCommandPalette();

        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({ commandPaletteOpen: false });
    });
});
