import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type PunchRecordingState } from '../../../stores/punchRecordingStore';
import { stopBackgroundCapture } from '../stopBackgroundCapture';

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

describe('stopBackgroundCapture', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('sets recording false on matching capture', () => {
        mockPunchRecordingStore.value = baseState({
            captures: [
                {
                    id: 'c1',
                    trackId: 't',
                    startBeat: 0,
                    endBeat: 4,
                    recording: true,
                    punchRegions: [],
                },
            ],
        });
        
        stopBackgroundCapture('c1');
        const next = mockPunchRecordingStore.set.mock.calls[0]![0] as PunchRecordingState;
        expect(next.captures[0]!.recording).toBe(false);
    });
});
