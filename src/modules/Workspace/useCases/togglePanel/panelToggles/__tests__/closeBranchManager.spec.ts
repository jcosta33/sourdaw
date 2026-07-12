import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../repositories/getWorkspaceState', () => ({
    getWorkspaceState: () => ({ sidebarOpen: false, mixerOpen: false }),
}));
vi.mock('../../../repositories/updateWorkspaceState', () => ({ updateWorkspaceState: vi.fn() }));
import { closeBranchManager } from '../closeBranchManager';

describe('closeBranchManager', () => {
    it('is a function', () => {
        expect(typeof closeBranchManager).toBe('function');
    });
    it('runs without crash', () => {
        expect(() => closeBranchManager()).not.toThrow();
    });
});
