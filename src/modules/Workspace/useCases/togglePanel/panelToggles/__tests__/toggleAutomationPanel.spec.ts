import { describe, it, expect, vi } from 'vitest';
vi.mock('../../../repositories/getWorkspaceState', () => ({ getWorkspaceState: () => ({ sidebarOpen: false, mixerOpen: false }) }));
vi.mock('../../../repositories/updateWorkspaceState', () => ({ updateWorkspaceState: vi.fn() }));
import { toggleAutomationPanel } from '../toggleAutomationPanel';
describe('toggleAutomationPanel', () => {
    it('is a function', () => { expect(typeof toggleAutomationPanel).toBe('function'); });
    it('runs without crash', () => { expect(() => toggleAutomationPanel()).not.toThrow(); });
});
