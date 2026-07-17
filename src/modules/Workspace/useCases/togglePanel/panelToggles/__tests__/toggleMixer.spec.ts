import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../repositories/getWorkspaceState', () => ({
    getWorkspaceState: () => ({ sidebarOpen: false, mixerOpen: false }),
}));
vi.mock('../../../../repositories/updateWorkspaceState', () => ({ updateWorkspaceState: vi.fn() }));
import { toggleMixer } from '../toggleMixer';

describe('toggleMixer', () => {
    it('is a function', () => {
        expect(typeof toggleMixer).toBe('function');
    });
    it('runs without crash', () => {
        expect(() => toggleMixer()).not.toThrow();
    });
});
