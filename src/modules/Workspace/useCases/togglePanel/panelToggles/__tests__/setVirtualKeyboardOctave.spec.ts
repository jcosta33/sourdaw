import { describe, it, expect, vi } from 'vitest';
vi.mock('../../../repositories/getWorkspaceState', () => ({ getWorkspaceState: () => ({ sidebarOpen: false, mixerOpen: false }) }));
vi.mock('../../../repositories/updateWorkspaceState', () => ({ updateWorkspaceState: vi.fn() }));
import { setVirtualKeyboardOctave } from '../setVirtualKeyboardOctave';
describe('setVirtualKeyboardOctave', () => {
    it('is a function', () => { expect(typeof setVirtualKeyboardOctave).toBe('function'); });
    it('runs without crash', () => { expect(() => setVirtualKeyboardOctave()).not.toThrow(); });
});
