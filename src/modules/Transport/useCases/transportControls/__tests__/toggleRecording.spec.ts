import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { defaultTransportState } from '../../../models/TransportState';
import { getTransportState } from '../../../repositories/transport/getTransportState';
import { updateTransportState } from '../../../repositories/transport/updateTransportState';
import { toggleRecording } from '../toggleRecording';

const mocks = vi.hoisted(() => ({
    scheduleClick: vi.fn<(...args: unknown[]) => void>(),
    resumeEngine: vi.fn<() => Promise<void>>(),
    notifyUser: vi.fn<(...args: unknown[]) => void>(),
    ensureTrackStrips: vi.fn<() => void>(),
    getAudioContext: vi.fn<() => { currentTime: number; baseLatency: number; outputLatency: number }>(),
    startPlayback: vi.fn<() => void>(),
    timeSignatureMapStore: { value: { changes: [] } as { changes: unknown[] } },
}));

vi.mock('../../../repositories/transport/getTransportState', () => ({
    getTransportState: vi.fn(),
}));
vi.mock('../../../repositories/transport/updateTransportState', () => ({
    updateTransportState: vi.fn(),
}));
vi.mock('../../../stores/timeSignatureMapStore', () => ({
    timeSignatureMapStore: mocks.timeSignatureMapStore,
}));

// Side-effecting collaborators of the count-in / recording paths.
vi.mock('../../ensureTrackStrips', () => ({ ensureTrackStrips: mocks.ensureTrackStrips }));
vi.mock('../startPlayback', () => ({ startPlayback: mocks.startPlayback }));
vi.mock('../recordingLifecycle', () => ({
    setCountInTimerId: vi.fn(),
    stopActiveRecording: vi.fn(),
}));
vi.mock('#/modules/Arrangement/useCases', () => ({
    getTrackStoreState: vi.fn(() => ({ tracks: [] })),
    updateClip: vi.fn(),
    startRecording: vi.fn(() => []),
}));
vi.mock('#/modules/AudioEngine/stores', () => ({
    audioBufferCache: { set: vi.fn(), get: vi.fn() },
}));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    resumeEngine: mocks.resumeEngine,
    getAudioContext: mocks.getAudioContext,
    scheduleClick: mocks.scheduleClick,
    startAudioRecording: vi.fn(),
    getCompensationDelay: vi.fn(() => 0),
}));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mocks.notifyUser }));

describe('toggleRecording', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        // resumeEngine returns Promise<void>; default to resolved so the `.catch`
        // chain in the count-in path has a thenable.
        mocks.resumeEngine.mockResolvedValue(undefined);
        mocks.getAudioContext.mockReturnValue({ currentTime: 0, baseLatency: 0, outputLatency: 0 });
        mocks.timeSignatureMapStore.value = { changes: [] };
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should not change transport when state is missing', () => {
        const update = vi.fn<typeof updateTransportState>();
        vi.mocked(getTransportState).mockReturnValue(null);
        vi.mocked(updateTransportState).mockImplementation(update);

        toggleRecording();

        expect(update).not.toHaveBeenCalled();
    });

    it('should count in using the resolved meter at the playhead, not the flat numerator', () => {
        // Flat numerator is 4, but a 3/4 change lands at the record point (beat 12).
        mocks.timeSignatureMapStore.value = {
            changes: [{ id: 'ts-1', beat: 12, numerator: 3, denominator: 4 }],
        };
        vi.mocked(getTransportState).mockReturnValue({
            ...defaultTransportState,
            isPlaying: false,
            isRecording: false,
            countInEnabled: true,
            countInBars: 2,
            timeSignatureNumerator: 4,
            timeSignatureDenominator: 4,
            playheadPosition: 12,
        });

        toggleRecording();

        // 2 bars * 3 beats/bar (resolved at beat 12) = 6 clicks, not 8.
        expect(mocks.scheduleClick).toHaveBeenCalledTimes(6);
    });

    it('surfaces a failed engine resume during count-in instead of swallowing it', async () => {
        // The microtask-based `.catch` needs real timers to flush.
        vi.useRealTimers();
        mocks.resumeEngine.mockRejectedValue(new Error('resume blocked'));
        vi.mocked(getTransportState).mockReturnValue({
            ...defaultTransportState,
            isPlaying: false,
            isRecording: false,
            countInEnabled: true,
            countInBars: 1,
            timeSignatureNumerator: 4,
            timeSignatureDenominator: 4,
            playheadPosition: 0,
        });

        toggleRecording();

        // Count-in clicks are still scheduled (resume is best-effort), but the
        // rejection is no longer dropped — the user is warned to re-arm.
        expect(mocks.scheduleClick).toHaveBeenCalled();
        await vi.waitFor(() => {
            expect(mocks.notifyUser).toHaveBeenCalledWith(expect.stringContaining('suspended'), 'warning');
        });
    });

    it('should fall back to the flat numerator when there is no time-sig change at the playhead', () => {
        mocks.timeSignatureMapStore.value = { changes: [] };
        vi.mocked(getTransportState).mockReturnValue({
            ...defaultTransportState,
            isPlaying: false,
            isRecording: false,
            countInEnabled: true,
            countInBars: 1,
            timeSignatureNumerator: 5,
            timeSignatureDenominator: 4,
            playheadPosition: 0,
        });

        toggleRecording();

        // 1 bar * 5 beats/bar = 5 clicks.
        expect(mocks.scheduleClick).toHaveBeenCalledTimes(5);
    });
});
