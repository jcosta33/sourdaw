import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type PunchRecordingState } from '../../../stores/punchRecordingStore';
import { stopBackgroundCapture } from '../stopBackgroundCapture';

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
        const next = mockPunchRecordingStore.set.mock.calls[0]?.[0];
        if (!next) {
            throw new Error('set was not called with arguments');
        }
        const capture = next.captures[0];
        if (!capture) {
            throw new Error('capture was not found');
        }
        expect(capture.recording).toBe(false);
    });
});
