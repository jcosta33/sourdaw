import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type PunchRecordingState } from '../../../stores/punchRecordingStore';
import { discardCapture } from '../discardCapture';

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

describe('discardCapture', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('removes capture', () => {
        mockPunchRecordingStore.value = baseState({
            captures: [
                {
                    id: 'c1',
                    trackId: 't',
                    startBeat: 0,
                    endBeat: 4,
                    recording: false,
                    punchRegions: [],
                },
            ],
        });

        discardCapture('c1');
        const next = mockPunchRecordingStore.set.mock.calls[0]![0] as PunchRecordingState;
        expect(next.captures).toHaveLength(0);
    });
});
