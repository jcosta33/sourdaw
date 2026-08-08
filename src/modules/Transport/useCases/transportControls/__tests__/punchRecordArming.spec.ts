import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { defaultTransportState, type TransportState } from '../../../models/TransportState';
import { recordingLifecycle } from '../recordingLifecycle';
import { toggleRecording } from '../toggleRecording';

/**
 * Pressing Record with punch enabled must arm the punch, not open a recording.
 *
 * `toggleRecording` took the punch branch straight into
 * `beginRecordingAndMaybePlayback`, commenting that "the punch-in/out points are
 * enforced by the scheduler". They are not, on this path: the scheduler's
 * punch-in branch is gated on `!current.isRecording`, so a recording opened by
 * the button leaves `schedulerSession.punchRecordingActive` false forever — and
 * the punch-*out* branch is gated on that flag. The result is a capture that
 * starts at the playhead instead of `punchInBeat` and runs past `punchOutBeat`
 * until the user stops it by hand: both ends of the punch region ignored, which
 * is the opposite of the comment's promise. Only the Play-triggered path worked.
 *
 * The corrected contract matches every shipping DAW's auto-punch: Record rolls
 * the transport and the region defines the record window. What this spec pins is
 * the state `toggleRecording` leaves behind, read off the transport state rather
 * than off a call: `isRecording === false` is exactly the scheduler's punch-in
 * precondition, and `startPlayheadScheduler.spec.ts` already proves the machine
 * punches in at `punchInBeat` and out at `punchOutBeat` from that state.
 *
 * The negatives matter as much as the positive: a fix that simply refused to
 * record whenever punch was enabled would pass the first case and silently kill
 * recording for a degenerate region the scheduler can never punch.
 */

type TestRecordingBuffer = { duration: number };
type TestRecordingClip = { id: string; trackId: string; startBeat: number; endBeat: number };
type TestTrack = { id: string; kind: 'audio' | 'midi'; armed: boolean };
type TestTrackState = { tracks: TestTrack[] };
type StartAudioRecording = (trackId: string, callback: (buffer: TestRecordingBuffer) => void) => Promise<boolean>;

const mocks = vi.hoisted(() => {
    const timeSignatureMapStore: { value: { changes: unknown[] } | null } = { value: { changes: [] } };
    // A live transport-state holder, so assertions read the state the code
    // actually wrote instead of the arguments it passed.
    const transport: { value: TransportState | null } = { value: null };
    return {
        transport,
        timeSignatureMapStore,
        scheduleClick: vi.fn<(...args: unknown[]) => void>(),
        resumeEngine: vi.fn<() => Promise<void>>(),
        notifyUser: vi.fn<(...args: unknown[]) => void>(),
        ensureTrackStrips: vi.fn<() => void>(),
        getAudioContext: vi.fn<() => { currentTime: number; baseLatency: number; outputLatency: number }>(),
        getTrackStoreState: vi.fn<() => TestTrackState | null>(() => ({ tracks: [] })),
        updateClip: vi.fn<(clipId: string, updater: (clip: TestRecordingClip) => TestRecordingClip) => void>(),
        startRecording: vi.fn<() => TestRecordingClip[]>(() => []),
        startPlayback: vi.fn<() => void>(),
        stopActiveRecording: vi.fn<() => Promise<void>>(),
        cacheAudioBuffer: vi.fn<(input: { buffer: TestRecordingBuffer; bufferId: string }) => string>(),
        startAudioRecording: vi.fn<StartAudioRecording>(),
        stopAudioRecording: vi.fn<() => Promise<void>>(),
        getCompensationDelay: vi.fn<(trackId: string) => number>(() => 0),
    };
});

vi.mock('../../../repositories/transport/getTransportState', () => ({
    getTransportState: () => mocks.transport.value,
}));
vi.mock('../../../repositories/transport/updateTransportState', () => ({
    updateTransportState: (patch: Partial<TransportState>) => {
        if (mocks.transport.value) {
            mocks.transport.value = { ...mocks.transport.value, ...patch };
        }
    },
}));
vi.mock('../../../stores/timeSignatureMapStore', () => ({
    timeSignatureMapStore: mocks.timeSignatureMapStore,
}));
vi.mock('../../ensureTrackStrips', () => ({ ensureTrackStrips: mocks.ensureTrackStrips }));
vi.mock('../startPlayback', () => ({
    startPlayback: () => {
        mocks.startPlayback();
        if (mocks.transport.value) {
            mocks.transport.value = { ...mocks.transport.value, isPlaying: true };
        }
    },
}));
vi.mock('../stopActiveRecording', () => ({ stopActiveRecording: mocks.stopActiveRecording }));
vi.mock('#/modules/Arrangement/useCases', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
    updateClip: mocks.updateClip,
    startRecording: mocks.startRecording,
}));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    resumeEngine: mocks.resumeEngine,
    getAudioContext: mocks.getAudioContext,
    scheduleClick: mocks.scheduleClick,
    cacheAudioBuffer: mocks.cacheAudioBuffer,
    startAudioRecording: mocks.startAudioRecording,
    stopAudioRecording: mocks.stopAudioRecording,
    getCompensationDelay: mocks.getCompensationDelay,
}));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mocks.notifyUser }));

const PUNCH_IN_BEAT = 8;
const PUNCH_OUT_BEAT = 16;

function seedTransport(patch: Partial<TransportState>): void {
    mocks.transport.value = {
        ...defaultTransportState,
        isPlaying: false,
        isRecording: false,
        countInEnabled: false,
        playheadPosition: 0,
        punchInEnabled: true,
        punchInBeat: PUNCH_IN_BEAT,
        punchOutBeat: PUNCH_OUT_BEAT,
        ...patch,
    };
}

function armedAudioTrack(): void {
    mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 'track-audio', kind: 'audio', armed: true }] });
}

/** Let `beginActualRecording`'s promise chain settle if one was started. */
async function settle(): Promise<void> {
    for (let index = 0; index < 4; index++) {
        await Promise.resolve();
    }
}

describe('pressing Record with punch enabled', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.resumeEngine.mockResolvedValue(undefined);
        mocks.startAudioRecording.mockResolvedValue(true);
        mocks.stopAudioRecording.mockResolvedValue(undefined);
        mocks.stopActiveRecording.mockImplementation(() => {
            recordingLifecycle.cancelPendingRecordingStart();
            recordingLifecycle.setCountInTimerId(null);
            return Promise.resolve();
        });
        recordingLifecycle.cancelPendingRecordingStart();
        recordingLifecycle.setCountInTimerId(null);
        mocks.getAudioContext.mockReturnValue({ currentTime: 0, baseLatency: 0, outputLatency: 0 });
        mocks.timeSignatureMapStore.value = { changes: [] };
        armedAudioTrack();
    });

    afterEach(() => {
        recordingLifecycle.cancelPendingRecordingStart();
        recordingLifecycle.setCountInTimerId(null);
        mocks.transport.value = null;
    });

    it('rolls the transport without opening a recording eight beats before the punch-in', async () => {
        seedTransport({ playheadPosition: 0 });

        toggleRecording();
        await settle();

        // The capture the old path opened here would be anchored at beat 0 —
        // `startRecording` reads the playhead for the new clip's startBeat.
        expect(mocks.startRecording).not.toHaveBeenCalled();
        expect(mocks.startAudioRecording).not.toHaveBeenCalled();
        expect(mocks.transport.value?.isRecording).toBe(false);
        // ...and `isRecording === false` is the scheduler's punch-in gate, so
        // the region — not the button — now decides both ends of the capture.
        expect(mocks.transport.value?.isPlaying).toBe(true);
        expect(mocks.transport.value?.playheadPosition).toBe(0);
    });

    it('does not restart playback when the transport is already rolling', async () => {
        seedTransport({ playheadPosition: 4, isPlaying: true });

        toggleRecording();
        await settle();

        expect(mocks.startPlayback).not.toHaveBeenCalled();
        expect(mocks.startRecording).not.toHaveBeenCalled();
        expect(mocks.transport.value?.isRecording).toBe(false);
    });

    // --- negatives: punch arming must not become "never record" ---

    it('records immediately when the punch region is degenerate and the scheduler can never punch', async () => {
        // The scheduler's punch-in branch requires punchInBeat < punchOutBeat.
        // Diverting here would leave Record dead with no path back to recording.
        seedTransport({ playheadPosition: 4, punchInBeat: 16, punchOutBeat: 16 });

        toggleRecording();
        await settle();

        expect(mocks.startRecording).toHaveBeenCalledOnce();
        expect(mocks.transport.value?.isRecording).toBe(true);
    });

    it('records immediately when punch is disabled', async () => {
        seedTransport({ playheadPosition: 4, punchInEnabled: false });

        toggleRecording();
        await settle();

        expect(mocks.startRecording).toHaveBeenCalledOnce();
        expect(mocks.transport.value?.isRecording).toBe(true);
    });

    it('still stops an in-progress recording when Record is pressed again', async () => {
        seedTransport({ playheadPosition: 12, isPlaying: true, isRecording: true });

        toggleRecording();
        await settle();

        expect(mocks.stopActiveRecording).toHaveBeenCalledOnce();
        expect(mocks.startPlayback).not.toHaveBeenCalled();
    });
});
