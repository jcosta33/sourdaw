import { describe, it, expect, vi } from 'vitest';
vi.mock('../../../repositories/getWorkspaceState', () => ({ getWorkspaceState: () => ({ sidebarOpen: false, mixerOpen: false }) }));
vi.mock('../../../repositories/updateWorkspaceState', () => ({ updateWorkspaceState: vi.fn() }));
import { toggleVirtualKeyboard } from '../toggleVirtualKeyboard';
describe('toggleVirtualKeyboard', () => {
    it('is a function', () => { expect(typeof toggleVirtualKeyboard).toBe('function'); });
    it('runs without crash', () => { expect(() => toggleVirtualKeyboard()).not.toThrow(); });
});
