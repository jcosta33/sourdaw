import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../repositories/getWorkspaceState', () => ({
    getWorkspaceState: () => ({ sidebarOpen: false, mixerOpen: false }),
}));
vi.mock('../../../repositories/updateWorkspaceState', () => ({ updateWorkspaceState: vi.fn() }));
import { toggleUndoHistory } from '../toggleUndoHistory';

describe('toggleUndoHistory', () => {
    it('is a function', () => {
        expect(typeof toggleUndoHistory).toBe('function');
    });
    it('runs without crash', () => {
        expect(() => toggleUndoHistory()).not.toThrow();
    });
});
