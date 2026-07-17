import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../repositories/getWorkspaceState', () => ({
    getWorkspaceState: () => ({ sidebarOpen: false, mixerOpen: false }),
}));
vi.mock('../../../../repositories/updateWorkspaceState', () => ({ updateWorkspaceState: vi.fn() }));
import { openInspector } from '../openInspector';

describe('openInspector', () => {
    it('is a function', () => {
        expect(typeof openInspector).toBe('function');
    });
    it('runs without crash', () => {
        expect(() => openInspector()).not.toThrow();
    });
});
