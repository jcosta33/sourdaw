import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../repositories/getWorkspaceState', () => ({
    getWorkspaceState: () => ({ sidebarOpen: false, mixerOpen: false }),
}));
vi.mock('../../../repositories/updateWorkspaceState', () => ({ updateWorkspaceState: vi.fn() }));
import { cycleChannelStripWidth } from '../cycleChannelStripWidth';

describe('cycleChannelStripWidth', () => {
    it('is a function', () => {
        expect(typeof cycleChannelStripWidth).toBe('function');
    });
    it('runs without crash', () => {
        expect(() => cycleChannelStripWidth()).not.toThrow();
    });
});
