import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type WorkspaceState } from '../../../../models/WorkspaceState';
import { cycleChannelStripWidth } from '../cycleChannelStripWidth';

const mocks = vi.hoisted(() => ({
    getWorkspaceState: vi.fn<() => Partial<WorkspaceState> | null>(),
    updateWorkspaceState: vi.fn(),
}));

vi.mock('../../../../repositories/getWorkspaceState', () => ({
    getWorkspaceState: mocks.getWorkspaceState,
}));
vi.mock('../../../../repositories/updateWorkspaceState', () => ({
    updateWorkspaceState: mocks.updateWorkspaceState,
}));

describe('cycleChannelStripWidth', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('does not update when workspace state is missing', () => {
        mocks.getWorkspaceState.mockReturnValue(null);

        cycleChannelStripWidth();

        expect(mocks.updateWorkspaceState).not.toHaveBeenCalled();
    });

    it('advances narrow to normal', () => {
        mocks.getWorkspaceState.mockReturnValue({ channelStripWidth: 'narrow' });

        cycleChannelStripWidth();

        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({ channelStripWidth: 'normal' });
    });

    it('advances normal to wide', () => {
        mocks.getWorkspaceState.mockReturnValue({ channelStripWidth: 'normal' });

        cycleChannelStripWidth();

        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({ channelStripWidth: 'wide' });
    });

    it('wraps wide back to narrow', () => {
        mocks.getWorkspaceState.mockReturnValue({ channelStripWidth: 'wide' });

        cycleChannelStripWidth();

        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({ channelStripWidth: 'narrow' });
    });
});
