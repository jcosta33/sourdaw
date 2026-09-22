import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type PunchRecordingState } from '../../../stores/punchRecordingStore';
import { startBackgroundCapture } from '../startBackgroundCapture';

const mockPunchRecordingStore = vi.hoisted(() => ({
    value: null as PunchRecordingState | null,
    set: vi.fn<(state: PunchRecordingState) => void>(),
}));

vi.mock('../../../stores/punchRecordingStore', () => ({
    punchRecordingStore: mockPunchRecordingStore,
}));

vi.mock('../../../repositories/punchRecordingIdCounter/getNextCaptureId', () => ({
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
        const next = mockPunchRecordingStore.set.mock.calls[0]?.[0];
        if (!next) {
            throw new Error('set was not called with arguments');
        }
        expect(next.captures).toHaveLength(1);
        const capture = next.captures[0];
        if (!capture) {
            throw new Error('capture was not created');
        }
        expect(capture.trackId).toBe('t1');
    });

    it('records one target track and stores no samples when enabled', () => {
        mockPunchRecordingStore.value = baseState({ enabled: true });

        startBackgroundCapture('track-a', 8);

        expect(mockPunchRecordingStore.set).toHaveBeenCalledTimes(1);
        const next = mockPunchRecordingStore.set.mock.calls[0]?.[0];
        if (!next) {
            throw new Error('set was not called with arguments');
        }
        expect(next.captures).toHaveLength(1);
        const capture = next.captures[0];
        if (!capture) {
            throw new Error('capture was not created');
        }
        expect(capture.trackId).toBe('track-a');
        expect(capture.startBeat).toBe(8);
        expect(capture.recording).toBe(true);
        expect(capture).not.toHaveProperty('samples');
        expect(capture).not.toHaveProperty('buffer');
        expect(Object.keys(capture).sort()).toEqual(
            ['endBeat', 'id', 'punchRegions', 'recording', 'startBeat', 'trackId'].sort(),
        );
    });

    it('returns without a record when disabled', () => {
        mockPunchRecordingStore.value = baseState({ enabled: false });

        startBackgroundCapture('track-a', 0);

        expect(mockPunchRecordingStore.set).not.toHaveBeenCalled();
    });
});
