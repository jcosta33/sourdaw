import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    updateWorkspaceState: vi.fn(),
}));

vi.mock('../../../../repositories/updateWorkspaceState', () => ({
    updateWorkspaceState: mocks.updateWorkspaceState,
}));

import { closeCommandPalette } from '../closeCommandPalette';

describe('closeCommandPalette', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('closes the command palette', () => {
        closeCommandPalette();

        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({ commandPaletteOpen: false });
    });
});
