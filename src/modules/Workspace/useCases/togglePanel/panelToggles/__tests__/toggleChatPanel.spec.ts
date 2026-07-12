import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../repositories/getWorkspaceState', () => ({
    getWorkspaceState: () => ({ sidebarOpen: false, mixerOpen: false }),
}));
vi.mock('../../../repositories/updateWorkspaceState', () => ({ updateWorkspaceState: vi.fn() }));
import { toggleChatPanel } from '../toggleChatPanel';

describe('toggleChatPanel', () => {
    it('is a function', () => {
        expect(typeof toggleChatPanel).toBe('function');
    });
    it('runs without crash', () => {
        expect(() => toggleChatPanel()).not.toThrow();
    });
});
