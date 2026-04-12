import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type PunchRecordingState } from '../../../stores/punchRecordingStore';
import { updateCapturePosition } from '../updateCapturePosition';

const mockPunchRecordingStore = vi.hoisted(() => ({
    value: null as any,
    set: vi.fn(),
}));

vi.mock('../../../stores/punchRecordingStore', () => ({
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

describe('updateCapturePosition', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('updates endBeat', () => {
        mockPunchRecordingStore.value = baseState({
            captures: [
                {
                    id: 'c1',
                    trackId: 't',
                    startBeat: 0,
                    endBeat: 2,
                    recording: true,
                    punchRegions: [],
                },
            ],
        });
        
        updateCapturePosition('c1', 16);
        const next = mockPunchRecordingStore.set.mock.calls[0]![0] as PunchRecordingState;
        expect(next.captures[0]!.endBeat).toBe(16);
    });
});
