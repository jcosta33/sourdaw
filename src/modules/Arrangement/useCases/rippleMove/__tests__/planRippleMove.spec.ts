import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createTrack, type Clip } from '../../../models/Track';
import { getTrackStoreState } from '../../getTrackStoreState';
import { planRippleMove } from '../planRippleMove';

import type { WorkspaceState } from '#/modules/WorkspaceShell/stores';

const { workspaceStoreMock } = vi.hoisted(() => ({
    workspaceStoreMock: { value: null as Partial<WorkspaceState> | null },
}));

vi.mock('../../getTrackStoreState', () => ({
    getTrackStoreState: vi.fn(),
}));

vi.mock('#/modules/WorkspaceShell/stores', () => ({
    workspaceStore: workspaceStoreMock,
}));

function makeClip(id: string, startBeat: number, endBeat: number): Clip {
    return {
        id,
        trackId: 't1',
        name: id,
        startBeat,
        endBeat,
        type: 'midi',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#000',
        locked: false,
        muted: false,
    };
}

describe('planRippleMove', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should return null if ripple editing is disabled', () => {
        workspaceStoreMock.value = { rippleEditing: false };
        expect(
            planRippleMove({ trackId: 't1', clipId: 'c1', oldStartBeat: 0, newStartBeat: 2, clipDuration: 2 })
        ).toBeNull();
    });

    it('should identify gap-closed and destination-opened clips', () => {
        workspaceStoreMock.value = { rippleEditing: true };
        vi.mocked(getTrackStoreState).mockReturnValue({
            tracks: [
                {
                    ...createTrack({ id: 't1', name: 'T1', kind: 'midi' }),
                    clips: [makeClip('c1', 0, 2), makeClip('c2', 2, 4), makeClip('c3', 10, 12), makeClip('c4', 12, 14)],
                },
            ],
            selectedTrackId: null,
        });

        // Move c1 from 0 to 8. Duration is 2.
        // Old end was 2. c2 is at 2. Gap closed: c2.
        // New start is 8. c3 is at 10. Destination opened: c3, c4.
        const plan = planRippleMove({
            trackId: 't1',
            clipId: 'c1',
            oldStartBeat: 0,
            newStartBeat: 8,
            clipDuration: 2,
        });

        // c2 closes the gap (starts at oldEndBeat=2); c3 and c4 are destination-opened only
        // (not double-counted in gapClosed since they're already in destinationOpened)
        expect(plan?.gapClosedClips.map((state) => state.clipId)).toEqual(['c2']);
        expect(plan?.destinationOpenedClips.map((state) => state.clipId)).toEqual(['c3', 'c4']);
    });
});
