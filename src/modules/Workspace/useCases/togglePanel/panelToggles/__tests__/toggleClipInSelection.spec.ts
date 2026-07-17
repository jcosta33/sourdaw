import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../repositories/getWorkspaceState', () => ({
    getWorkspaceState: () => ({ sidebarOpen: false, mixerOpen: false }),
}));
vi.mock('../../../../repositories/updateWorkspaceState', () => ({ updateWorkspaceState: vi.fn() }));
import { toggleClipInSelection } from '../toggleClipInSelection';

describe('toggleClipInSelection', () => {
    it('is a function', () => {
        expect(typeof toggleClipInSelection).toBe('function');
    });
    it('runs without crash', () => {
        expect(() => toggleClipInSelection()).not.toThrow();
    });
});
