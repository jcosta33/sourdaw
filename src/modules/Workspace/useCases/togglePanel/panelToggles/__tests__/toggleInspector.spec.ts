import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../repositories/getWorkspaceState', () => ({
    getWorkspaceState: () => ({ sidebarOpen: false, mixerOpen: false }),
}));
vi.mock('../../../repositories/updateWorkspaceState', () => ({ updateWorkspaceState: vi.fn() }));
import { toggleInspector } from '../toggleInspector';

describe('toggleInspector', () => {
    it('is a function', () => {
        expect(typeof toggleInspector).toBe('function');
    });
    it('runs without crash', () => {
        expect(() => toggleInspector()).not.toThrow();
    });
});
