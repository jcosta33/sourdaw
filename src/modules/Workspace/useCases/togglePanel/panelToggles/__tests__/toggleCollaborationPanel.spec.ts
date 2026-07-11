import { describe, it, expect, vi } from 'vitest';
vi.mock('../../../repositories/getWorkspaceState', () => ({ getWorkspaceState: () => ({ sidebarOpen: false, mixerOpen: false }) }));
vi.mock('../../../repositories/updateWorkspaceState', () => ({ updateWorkspaceState: vi.fn() }));
import { toggleCollaborationPanel } from '../toggleCollaborationPanel';
describe('toggleCollaborationPanel', () => {
    it('is a function', () => { expect(typeof toggleCollaborationPanel).toBe('function'); });
    it('runs without crash', () => { expect(() => toggleCollaborationPanel()).not.toThrow(); });
});
