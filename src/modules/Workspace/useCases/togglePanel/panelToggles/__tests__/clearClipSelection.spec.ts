import { describe, it, expect, vi } from 'vitest';
vi.mock('../../../repositories/getWorkspaceState', () => ({ getWorkspaceState: () => ({ sidebarOpen: false, mixerOpen: false }) }));
vi.mock('../../../repositories/updateWorkspaceState', () => ({ updateWorkspaceState: vi.fn() }));
import { clearClipSelection } from '../clearClipSelection';
describe('clearClipSelection', () => {
    it('is a function', () => { expect(typeof clearClipSelection).toBe('function'); });
    it('runs without crash', () => { expect(() => clearClipSelection()).not.toThrow(); });
});
