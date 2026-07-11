import { describe, it, expect, vi } from 'vitest';
vi.mock('../../../repositories/getWorkspaceState', () => ({ getWorkspaceState: () => ({ sidebarOpen: false, mixerOpen: false }) }));
vi.mock('../../../repositories/updateWorkspaceState', () => ({ updateWorkspaceState: vi.fn() }));
import { setSnapValue } from '../setSnapValue';
describe('setSnapValue', () => {
    it('is a function', () => { expect(typeof setSnapValue).toBe('function'); });
    it('runs without crash', () => { expect(() => setSnapValue()).not.toThrow(); });
});
