import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../repositories/getWorkspaceState', () => ({
    getWorkspaceState: () => ({ sidebarOpen: false, mixerOpen: false }),
}));
vi.mock('../../../repositories/updateWorkspaceState', () => ({ updateWorkspaceState: vi.fn() }));
import { toggleTrackList } from '../toggleTrackList';

describe('toggleTrackList', () => {
    it('is a function', () => {
        expect(typeof toggleTrackList).toBe('function');
    });
    it('runs without crash', () => {
        expect(() => toggleTrackList()).not.toThrow();
    });
});
