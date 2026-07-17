import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../repositories/getWorkspaceState', () => ({
    getWorkspaceState: () => ({ sidebarOpen: false, mixerOpen: false }),
}));
vi.mock('../../../../repositories/updateWorkspaceState', () => ({ updateWorkspaceState: vi.fn() }));
import { toggleCommandPalette } from '../toggleCommandPalette';

describe('toggleCommandPalette', () => {
    it('is a function', () => {
        expect(typeof toggleCommandPalette).toBe('function');
    });
    it('runs without crash', () => {
        expect(() => toggleCommandPalette()).not.toThrow();
    });
});
