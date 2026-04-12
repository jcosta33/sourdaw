import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type PunchRecordingState } from '../../../stores/punchRecordingStore';
import { setPreRoll } from '../setPreRoll';

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

describe('setPreRoll', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('writes defaultPreRoll', () => {
        mockPunchRecordingStore.value = baseState();
        setPreRoll(8);
        expect(mockPunchRecordingStore.set).toHaveBeenCalledWith(expect.objectContaining({ defaultPreRoll: 8 }));
    });
});
