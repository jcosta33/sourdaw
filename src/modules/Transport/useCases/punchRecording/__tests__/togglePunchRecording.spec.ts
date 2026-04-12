import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type PunchRecordingState } from '#/modules/Transport/stores/punchRecordingStore';
import { togglePunchRecording } from '../togglePunchRecording';

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
