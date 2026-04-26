import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type PunchRecordingState } from '../../../stores/punchRecordingStore';
import { togglePunchRecording } from '../togglePunchRecording';

const mockPunchRecordingStore = vi.hoisted(() => ({
    value: null as PunchRecordingState | null,
    set: vi.fn<(state: PunchRecordingState) => void>(),
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

describe('togglePunchRecording', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('flips enabled', () => {
        mockPunchRecordingStore.value = baseState({ enabled: false });
        togglePunchRecording();
        expect(mockPunchRecordingStore.set).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }));
    });
});
