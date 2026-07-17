import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../repositories/getWorkspaceState', () => ({
    getWorkspaceState: () => ({ sidebarOpen: false, mixerOpen: false }),
}));
vi.mock('../../../../repositories/updateWorkspaceState', () => ({ updateWorkspaceState: vi.fn() }));
import { selectClip } from '../selectClip';

describe('selectClip', () => {
    it('is a function', () => {
        expect(typeof selectClip).toBe('function');
    });
    it('runs without crash', () => {
        expect(() => selectClip('clip-1')).not.toThrow();
    });
});
