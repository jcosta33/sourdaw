import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../repositories/getWorkspaceState', () => ({
    getWorkspaceState: () => ({ sidebarOpen: false, mixerOpen: false }),
}));
vi.mock('../../../../repositories/updateWorkspaceState', () => ({ updateWorkspaceState: vi.fn() }));
import { closeCommandPalette } from '../closeCommandPalette';

describe('closeCommandPalette', () => {
    it('is a function', () => {
        expect(typeof closeCommandPalette).toBe('function');
    });
    it('runs without crash', () => {
        expect(() => closeCommandPalette()).not.toThrow();
    });
});
