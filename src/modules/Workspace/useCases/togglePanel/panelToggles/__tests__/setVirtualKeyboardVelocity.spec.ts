import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../repositories/getWorkspaceState', () => ({
    getWorkspaceState: () => ({ sidebarOpen: false, mixerOpen: false }),
}));
vi.mock('../../../repositories/updateWorkspaceState', () => ({ updateWorkspaceState: vi.fn() }));
import { setVirtualKeyboardVelocity } from '../setVirtualKeyboardVelocity';

describe('setVirtualKeyboardVelocity', () => {
    it('is a function', () => {
        expect(typeof setVirtualKeyboardVelocity).toBe('function');
    });
    it('runs without crash', () => {
        expect(() => setVirtualKeyboardVelocity()).not.toThrow();
    });
});
