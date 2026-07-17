import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../repositories/getWorkspaceState', () => ({
    getWorkspaceState: () => ({ sidebarOpen: false, mixerOpen: false }),
}));
vi.mock('../../../../repositories/updateWorkspaceState', () => ({ updateWorkspaceState: vi.fn() }));
import { setTrackListWidth } from '../setTrackListWidth';

describe('setTrackListWidth', () => {
    it('is a function', () => {
        expect(typeof setTrackListWidth).toBe('function');
    });
    it('runs without crash', () => {
        expect(() => setTrackListWidth()).not.toThrow();
    });
});
