import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../repositories/getWorkspaceState', () => ({
    getWorkspaceState: () => ({ sidebarOpen: false, mixerOpen: false }),
}));
vi.mock('../../../repositories/updateWorkspaceState', () => ({ updateWorkspaceState: vi.fn() }));
import { toggleWorkspaceMode } from '../toggleWorkspaceMode';

describe('toggleWorkspaceMode', () => {
    it('is a function', () => {
        expect(typeof toggleWorkspaceMode).toBe('function');
    });
    it('runs without crash', () => {
        expect(() => toggleWorkspaceMode()).not.toThrow();
    });
});
