import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../repositories/getWorkspaceState', () => ({
    getWorkspaceState: () => ({ sidebarOpen: false, mixerOpen: false }),
}));
vi.mock('../../../repositories/updateWorkspaceState', () => ({ updateWorkspaceState: vi.fn() }));
import { toggleBranchManager } from '../toggleBranchManager';

describe('toggleBranchManager', () => {
    it('is a function', () => {
        expect(typeof toggleBranchManager).toBe('function');
    });
    it('runs without crash', () => {
        expect(() => toggleBranchManager()).not.toThrow();
    });
});
