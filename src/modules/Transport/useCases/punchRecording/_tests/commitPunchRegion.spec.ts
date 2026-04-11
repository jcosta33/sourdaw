import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type PunchRecordingState } from '#/modules/Transport/stores/punchRecordingStore';
import { commitPunchRegion } from '../commitPunchRegion';

const mockPunchRecordingStore = vi.hoisted(() => ({
    value: null as any,
    set: vi.fn(),
}));

vi.mock('#/modules/Transport/stores/punchRecordingStore', () => ({
    punchRecordingStore: mockPunchRecordingStore,
}));

function baseState(overrides: Partial<PunchRecordingState> = {}): PunchRecordingState {
    return {
        captures: [],
        defaultPreRoll: 4,
        defaultPostRoll: 2,
        defaultCrossfade: 0.25,
        enabled: false,
        ...overrides,
    };
}

describe('commitPunchRegion', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('marks region committed', () => {
        mockPunchRecordingStore.value = baseState({
            captures: [
                {
                    id: 'cap1',
                    trackId: 't',
                    startBeat: 0,
                    endBeat: 8,
                    recording: false,
                    punchRegions: [
                        {
                            id: 'r1',
                            trackId: 't',
                            punchInBeat: 2,
                            punchOutBeat: 4,
                            sourceClipId: 'cap1',
                            preRollBeats: 1,
                            postRollBeats: 1,
                            committed: false,
                            crossfadeBeats: 0,
                        },
                    ],
                },
            ],
        });
        
        commitPunchRegion('cap1', 'r1');
        const next = mockPunchRecordingStore.set.mock.calls[0]![0] as PunchRecordingState;
        expect(next.captures[0]!.punchRegions[0]!.committed).toBe(true);
    });
});
