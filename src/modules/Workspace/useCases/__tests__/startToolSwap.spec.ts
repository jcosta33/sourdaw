import { describe, it, expect, vi, beforeEach } from 'vitest';

import { defaultWorkspaceState } from '../../models/WorkspaceState';
import { getWorkspaceState } from '../../repositories/getWorkspaceState';
import { toolSwapStore } from '../../stores/toolSwapStore';
import { startToolSwap } from '../startToolSwap';

vi.mock('../../repositories/getWorkspaceState', () => ({
    getWorkspaceState: vi.fn(),
}));

vi.mock('../../stores/toolSwapStore', () => ({
    toolSwapStore: {
        set: vi.fn(),
    },
}));

describe('startToolSwap', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getWorkspaceState).mockReturnValue({
            ...defaultWorkspaceState,
            activeTool: 'select',
        });
    });

    it('should record the previous tool when the requested tool differs from the active tool', () => {
        startToolSwap({ key: 'd', timestamp: 1234, tool: 'draw' });

        expect(toolSwapStore.set).toHaveBeenCalledWith({
            lastDownKey: 'd',
            lastDownTime: 1234,
            previousTool: 'select',
        });
    });

    it('should not record a swap when the workspace state is unavailable', () => {
        vi.mocked(getWorkspaceState).mockReturnValue(null);

        startToolSwap({ key: 'd', timestamp: 1234, tool: 'draw' });

        expect(toolSwapStore.set).not.toHaveBeenCalled();
    });

    it('should not record a swap when the requested tool is already active', () => {
        vi.mocked(getWorkspaceState).mockReturnValue({
            ...defaultWorkspaceState,
            activeTool: 'draw',
        });

        startToolSwap({ key: 'd', timestamp: 1234, tool: 'draw' });

        expect(toolSwapStore.set).not.toHaveBeenCalled();
    });
});
