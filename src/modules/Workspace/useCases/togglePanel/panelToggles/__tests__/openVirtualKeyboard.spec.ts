import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../repositories/getWorkspaceState', () => ({
    getWorkspaceState: () => ({ sidebarOpen: false, mixerOpen: false }),
}));
vi.mock('../../../../repositories/updateWorkspaceState', () => ({ updateWorkspaceState: vi.fn() }));
import { openVirtualKeyboard } from '../openVirtualKeyboard';

describe('openVirtualKeyboard', () => {
    it('is a function', () => {
        expect(typeof openVirtualKeyboard).toBe('function');
    });
    it('runs without crash', () => {
        expect(() => openVirtualKeyboard()).not.toThrow();
    });
});
