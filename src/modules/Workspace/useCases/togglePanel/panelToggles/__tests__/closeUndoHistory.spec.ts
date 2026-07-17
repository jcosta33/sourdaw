import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../repositories/getWorkspaceState', () => ({
    getWorkspaceState: () => ({ sidebarOpen: false, mixerOpen: false }),
}));
vi.mock('../../../../repositories/updateWorkspaceState', () => ({ updateWorkspaceState: vi.fn() }));
import { closeUndoHistory } from '../closeUndoHistory';

describe('closeUndoHistory', () => {
    it('is a function', () => {
        expect(typeof closeUndoHistory).toBe('function');
    });
    it('runs without crash', () => {
        expect(() => closeUndoHistory()).not.toThrow();
    });
});
