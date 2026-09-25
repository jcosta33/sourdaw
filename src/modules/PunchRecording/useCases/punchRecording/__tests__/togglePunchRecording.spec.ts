import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type PunchRecordingState } from '../../../stores/punchRecordingStore';
import { togglePunchRecording } from '../togglePunchRecording';

const mockPunchRecordingStore = vi.hoisted(() => ({
    value: null as PunchRecordingState | null,
    set: vi.fn<(state: PunchRecordingState) => void>(),
}));

const mockTrackStore = vi.hoisted(() => ({
    value: null as {
        tracks: ReadonlyArray<{ id: string; kind: string }>;
        selectedTrackId: string | null;
    } | null,
}));

const mockArm = vi.hoisted(() => vi.fn());
const mockDisarm = vi.hoisted(() => vi.fn());

vi.mock('../../../stores/punchRecordingStore', () => ({
    punchRecordingStore: mockPunchRecordingStore,
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: mockTrackStore,
    getTrackEligibility: (kind: string) => ({
        acceptsRecording: kind === 'audio' || kind === 'midi',
    }),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    armRetrospectiveCapture: mockArm,
    disarmRetrospectiveCapture: mockDisarm,
}));

vi.mock('#/modules/Command/useCases', () => ({
    pushUndoEntry: vi.fn(),
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
        mockTrackStore.value = null;
    });

    it('flips enabled', () => {
        mockPunchRecordingStore.value = baseState({ enabled: false });
        togglePunchRecording();
        expect(mockPunchRecordingStore.set).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }));
    });

    it('arms once when enabling with one selected eligible audio track', () => {
        mockPunchRecordingStore.value = baseState({ enabled: false });
        mockTrackStore.value = {
            tracks: [{ id: 'audio-1', kind: 'audio' }],
            selectedTrackId: 'audio-1',
        };

        togglePunchRecording();

        expect(mockArm).toHaveBeenCalledTimes(1);
        expect(mockArm).toHaveBeenCalledWith('audio-1');
        expect(mockDisarm).not.toHaveBeenCalled();
    });

    it('disarms when disabling', () => {
        mockPunchRecordingStore.value = baseState({ enabled: true });
        mockTrackStore.value = {
            tracks: [{ id: 'audio-1', kind: 'audio' }],
            selectedTrackId: 'audio-1',
        };

        togglePunchRecording();

        expect(mockDisarm).toHaveBeenCalledTimes(1);
        expect(mockArm).not.toHaveBeenCalled();
        expect(mockPunchRecordingStore.set).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
    });

    it('does not arm when no eligible track is selected', () => {
        mockPunchRecordingStore.value = baseState({ enabled: false });
        mockTrackStore.value = {
            tracks: [{ id: 'vca-1', kind: 'vca' }],
            selectedTrackId: 'vca-1',
        };

        togglePunchRecording();

        expect(mockArm).not.toHaveBeenCalled();
        expect(mockDisarm).not.toHaveBeenCalled();
        expect(mockPunchRecordingStore.set).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }));
    });

    it('does not invent a track when nothing is selected', () => {
        mockPunchRecordingStore.value = baseState({ enabled: false });
        mockTrackStore.value = {
            tracks: [{ id: 'audio-1', kind: 'audio' }],
            selectedTrackId: null,
        };

        togglePunchRecording();

        expect(mockArm).not.toHaveBeenCalled();
    });
});
