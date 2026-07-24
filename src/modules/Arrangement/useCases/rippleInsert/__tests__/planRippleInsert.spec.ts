import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getTrackStoreState } from '../../getTrackStoreState';
import { planRippleInsert } from '../planRippleInsert';

vi.mock('../../getTrackStoreState', () => ({
    getTrackStoreState: vi.fn(),
}));

const mocks = vi.hoisted(() => ({
    workspaceStoreValue: { value: null as { rippleEditing: boolean } | null },
}));

vi.mock('#/modules/WorkspaceShell/stores', () => ({
    workspaceStore: {
        get value() {
            return mocks.workspaceStoreValue.value;
        },
    },
}));

describe('planRippleInsert', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should return null if ripple editing is disabled', () => {
        mocks.workspaceStoreValue.value = { rippleEditing: false };
        expect(planRippleInsert({ trackId: 't1', insertBeat: 0, insertDuration: 1 })).toBeNull();
    });

    it('should return null when the workspace store is empty (ripple defaults to off)', () => {
        mocks.workspaceStoreValue.value = null;
        expect(planRippleInsert({ trackId: 't1', insertBeat: 0, insertDuration: 1 })).toBeNull();
    });

    it('should return null when the track store is empty', () => {
        mocks.workspaceStoreValue.value = { rippleEditing: true };
        vi.mocked(getTrackStoreState).mockReturnValue(null);
        expect(planRippleInsert({ trackId: 't1', insertBeat: 0, insertDuration: 1 })).toBeNull();
    });

    it('should return null when the track id is unknown', () => {
        mocks.workspaceStoreValue.value = { rippleEditing: true };
        vi.mocked(getTrackStoreState).mockReturnValue({ tracks: [], selectedTrackId: null });
        expect(planRippleInsert({ trackId: 'missing', insertBeat: 0, insertDuration: 1 })).toBeNull();
    });

    it('should return shifted clips forward in time from insert point', () => {
        mocks.workspaceStoreValue.value = { rippleEditing: true };
        (getTrackStoreState as any).mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    clips: [
                        { id: 'c1', startBeat: 0, endBeat: 2 },
                        { id: 'c2', startBeat: 2, endBeat: 4 },
                        { id: 'c3', startBeat: 5, endBeat: 6 },
                    ],
                },
            ],
        });

        const plan = planRippleInsert({ trackId: 't1', insertBeat: 2, insertDuration: 1 });
        expect(plan?.shiftedClips.length).toBe(2);
        expect(plan?.shiftedClips.map((state) => state.clipId)).toEqual(['c2', 'c3']);
    });

    it('should return empty shifted clips if insertion point is at end', () => {
        mocks.workspaceStoreValue.value = { rippleEditing: true };
        (getTrackStoreState as any).mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    clips: [{ id: 'c1', startBeat: 0, endBeat: 2 }],
                },
            ],
        });

        const plan = planRippleInsert({ trackId: 't1', insertBeat: 4, insertDuration: 1 });
        expect(plan?.shiftedClips.length).toBe(0);
    });
});
