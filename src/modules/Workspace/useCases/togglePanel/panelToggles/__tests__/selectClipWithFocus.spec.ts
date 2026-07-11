import { describe, it, expect, vi } from 'vitest';
vi.mock('../../../repositories/getWorkspaceState', () => ({ getWorkspaceState: () => ({ sidebarOpen: false, mixerOpen: false }) }));
vi.mock('../../../repositories/updateWorkspaceState', () => ({ updateWorkspaceState: vi.fn() }));
import { selectClipWithFocus } from '../selectClipWithFocus';
describe('selectClipWithFocus', () => {
    it('is a function', () => { expect(typeof selectClipWithFocus).toBe('function'); });
    it('runs without crash', () => { expect(() => selectClipWithFocus()).not.toThrow(); });
});
