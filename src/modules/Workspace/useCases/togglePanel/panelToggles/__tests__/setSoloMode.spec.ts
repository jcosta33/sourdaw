import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../repositories/getWorkspaceState', () => ({
    getWorkspaceState: () => ({ sidebarOpen: false, mixerOpen: false }),
}));
vi.mock('../../../repositories/updateWorkspaceState', () => ({ updateWorkspaceState: vi.fn() }));
import { setSoloMode } from '../setSoloMode';

describe('setSoloMode', () => {
    it('is a function', () => {
        expect(typeof setSoloMode).toBe('function');
    });
    it('runs without crash', () => {
        expect(() => setSoloMode()).not.toThrow();
    });
});
