import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../repositories/getWorkspaceState', () => ({
    getWorkspaceState: () => ({ sidebarOpen: false, mixerOpen: false }),
}));
vi.mock('../../../../repositories/updateWorkspaceState', () => ({ updateWorkspaceState: vi.fn() }));
import { closeScratchPad } from '../closeScratchPad';

describe('closeScratchPad', () => {
    it('is a function', () => {
        expect(typeof closeScratchPad).toBe('function');
    });
    it('runs without crash', () => {
        expect(() => closeScratchPad()).not.toThrow();
    });
});
