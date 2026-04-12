import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type PunchRecordingState } from '#/modules/Transport/stores/punchRecordingStore';
import { definePunchRegion } from '../definePunchRegion';

const mockPunchRecordingStore = vi.hoisted(() => ({
    value: null as any,
    set: vi.fn(),
}));

vi.mock('#/modules/Transport/stores/punchRecordingStore', () => ({
    punchRecordingStore: mockPunchRecordingStore,
}));

vi.mock('../../repositories/punchRecordingIdCounter/getNextPunchId', () => ({
    getNextPunchId: () => 'punch-1',
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

describe('definePunchRegion', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('appends a punch region to the capture', () => {
        mockPunchRecordingStore.value = baseState({
            captures: [
                {
                    id: 'cap1',
                    trackId: 't1',
                    startBeat: 0,
                    endBeat: 8,
                    recording: false,
                    punchRegions: [],
                },
            ],
        });
        
        definePunchRegion('cap1', 2, 6);
        const next = mockPunchRecordingStore.set.mock.calls[0]![0] as PunchRecordingState;
        expect(next.captures[0]!.punchRegions).toHaveLength(1);
        expect(next.captures[0]!.punchRegions[0]!.punchInBeat).toBe(2);
    });
});
