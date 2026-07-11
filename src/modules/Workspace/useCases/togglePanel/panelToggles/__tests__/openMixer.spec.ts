import { describe, it, expect, vi } from 'vitest';
vi.mock('../../../repositories/getWorkspaceState', () => ({ getWorkspaceState: () => ({ sidebarOpen: false, mixerOpen: false }) }));
vi.mock('../../../repositories/updateWorkspaceState', () => ({ updateWorkspaceState: vi.fn() }));
import { openMixer } from '../openMixer';
describe('openMixer', () => {
    it('is a function', () => { expect(typeof openMixer).toBe('function'); });
    it('runs without crash', () => { expect(() => openMixer()).not.toThrow(); });
});
