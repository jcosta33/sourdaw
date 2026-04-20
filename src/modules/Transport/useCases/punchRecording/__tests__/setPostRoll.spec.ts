import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type PunchRecordingState } from '../../../stores/punchRecordingStore';
import { setPostRoll } from '../setPostRoll';

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

describe('setPostRoll', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('writes defaultPostRoll', () => {
        mockPunchRecordingStore.value = baseState();
        setPostRoll(6);
        expect(mockPunchRecordingStore.set).toHaveBeenCalledWith(expect.objectContaining({ defaultPostRoll: 6 }));
    });
});
