import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type PunchRecordingState } from '../../../stores/punchRecordingStore';
import { startBackgroundCapture } from '../startBackgroundCapture';

const mockPunchRecordingStore = vi.hoisted(() => ({
    value: null as any,
    set: vi.fn(),
}));

vi.mock('../../../stores/punchRecordingStore', () => ({
    punchRecordingStore: mockPunchRecordingStore,
}));

vi.mock('../../repositories/punchRecordingIdCounter/getNextCaptureId', () => ({
    getNextCaptureId: () => 'cap-1',
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

describe('startBackgroundCapture', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('appends capture when enabled', () => {
        mockPunchRecordingStore.value = baseState({ enabled: true });
        
        startBackgroundCapture('t1', 0);
        
        expect(mockPunchRecordingStore.set).toHaveBeenCalledTimes(1);
        const next = mockPunchRecordingStore.set.mock.calls[0]![0] as PunchRecordingState;
        expect(next.captures).toHaveLength(1);
        expect(next.captures[0]!.trackId).toBe('t1');
    });
});
