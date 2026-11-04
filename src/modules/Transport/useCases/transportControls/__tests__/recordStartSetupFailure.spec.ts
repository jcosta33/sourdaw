import { beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultTransportState, type TransportState } from '../../../models/TransportState';
import { recordingLifecycle } from '../recordingLifecycle';
import { toggleRecording } from '../toggleRecording';

const fixture = vi.hoisted(() => {
    const state: { current: TransportState | null } = { current: null };
    const activeRecordingRef: { current: string[]; capturedRootIdentity: string | null } = {
        current: [],
        capturedRootIdentity: null,
    };
    const capture: {
        terminal: ((result: { kind: 'completed'; buffer: { duration: number } }) => void) | null;
    } = { terminal: null };
    return {
        state,
        activeRecordingRef,
        capture,
        root: { current: 'root-a' },
        setupWitness: { recordingIds: [] as string[], state: null as TransportState | null },
        audioClock: { currentTime: 10, baseLatency: 0, outputLatency: 0 },
        ensureTrackStrips: vi.fn<() => void>(),
        stopAudioRecording: vi.fn<() => Promise<void>>(),
        stopRecording: vi.fn<() => Promise<'closed'>>(),
        commitRecording: vi.fn<() => Promise<void>>(),
        discardRecording: vi.fn(),
        logError: vi.fn(),
        notifyUser: vi.fn(),
    };
});

vi.mock('#/infra/logger/appLogger', () => ({ logger: { error: fixture.logError, warn: vi.fn() } }));
vi.mock('#/modules/Arrangement/stores', () => ({
    activeRecordingRef: fixture.activeRecordingRef,
    getTrackEligibility: () => ({ acceptsRecording: true }),
}));
vi.mock('#/modules/Arrangement/useCases', () => ({
    getTrackStoreState: () => ({ tracks: [{ id: 'audio-1', armed: true, kind: 'audio' }] }),
    startRecording: () => {
        fixture.activeRecordingRef.current = ['take-1'];
        fixture.activeRecordingRef.capturedRootIdentity = fixture.root.current;
        return [{ id: 'take-1', trackId: 'audio-1', startBeat: 0, endBeat: 0 }];
    },
    stopRecording: fixture.stopRecording,
    takeOwnsRecordingRoot: () => true,
    commitRecording: fixture.commitRecording,
    discardRecording: fixture.discardRecording,
}));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    resumeEngine: () => Promise.resolve(),
    nativeLiveGraphSessionOffered: () => false,
    startNativeLiveGraphSession: () => Promise.resolve({ outcome: 'declined', reason: 'browser fixture' }),
    getAudioContext: () => fixture.audioClock,
    getCompensationDelay: () => 0,
    startAudioRecording: (_trackId: string, terminal: typeof fixture.capture.terminal) => {
        fixture.capture.terminal = terminal;
        return Promise.resolve(true);
    },
    stopAudioRecording: fixture.stopAudioRecording,
    cacheAudioBuffer: vi.fn(),
    scheduleClick: vi.fn(),
}));
vi.mock('#/modules/MIDI/useCases', () => ({
    countSettledOverdubPasses: () => 0,
    isOverdubLanding: () => false,
    waitForOverdubLanding: () => Promise.resolve(),
}));
vi.mock('#/modules/CrdtDocument/useCases', () => ({
    captureProjectRootIdentity: () => fixture.root.current,
}));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: fixture.notifyUser }));
vi.mock('../../../repositories/transport/getTransportState', () => ({
    getTransportState: () => fixture.state.current,
}));
vi.mock('../../../repositories/transport/updateTransportState', () => ({
    updateTransportState: (patch: Partial<TransportState>) => {
        if (fixture.state.current) {
            fixture.state.current = { ...fixture.state.current, ...patch };
        }
    },
}));
vi.mock('../../../stores/timeSignatureMapStore', () => ({ timeSignatureMapStore: { value: { changes: [] } } }));
vi.mock('../../../stores/tempoMapStore', () => ({ tempoMapStore: { value: { changes: [] } } }));
vi.mock('../../ensureTrackStrips', () => ({ ensureTrackStrips: fixture.ensureTrackStrips }));
vi.mock('../../playheadScheduler/prepareInitialBrowserPlayback', () => ({ prepareInitialBrowserPlayback: vi.fn() }));
vi.mock('../../playheadScheduler/startPlayheadScheduler', () => ({ startPlayheadScheduler: vi.fn() }));
vi.mock('../stopPlayback', () => ({ stopPlayback: vi.fn() }));

describe('Record from stopped when playback setup fails', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        fixture.state.current = { ...defaultTransportState, isPlaying: false, isRecording: false };
        fixture.activeRecordingRef.current = [];
        fixture.activeRecordingRef.capturedRootIdentity = null;
        fixture.capture.terminal = null;
        fixture.root.current = 'root-a';
        fixture.setupWitness.recordingIds = [];
        fixture.setupWitness.state = null;
        fixture.audioClock.currentTime = 10;
        recordingLifecycle.cancelPendingRecordingStart();
        fixture.ensureTrackStrips.mockImplementation(() => {
            fixture.setupWitness.recordingIds = [...fixture.activeRecordingRef.current];
            fixture.setupWitness.state = fixture.state.current;
            throw new Error('strip setup failed');
        });
        fixture.commitRecording.mockResolvedValue(undefined);
        fixture.stopRecording.mockImplementation(async () => {
            fixture.activeRecordingRef.current = [];
            return 'closed';
        });
        fixture.stopAudioRecording.mockImplementation(async () => {
            fixture.capture.terminal?.({ kind: 'completed', buffer: { duration: 2 } });
        });
    });

    it('closes and commits the admitted capture after the real Play setup rejects', async () => {
        toggleRecording();

        await vi.waitFor(() => expect(fixture.ensureTrackStrips).toHaveBeenCalledOnce());
        expect(fixture.setupWitness.recordingIds).toEqual(['take-1']);
        expect(fixture.setupWitness.state).toMatchObject({ isPlaying: false, isRecording: true });
        await vi.waitFor(() => expect(fixture.stopAudioRecording).toHaveBeenCalledOnce());
        await vi.waitFor(() => expect(fixture.commitRecording).toHaveBeenCalledOnce());
        expect(fixture.stopRecording).toHaveBeenCalledOnce();
        expect(fixture.discardRecording).not.toHaveBeenCalled();
        expect(fixture.state.current).toMatchObject({ isPlaying: false, isRecording: false });
        expect(fixture.notifyUser).toHaveBeenCalledWith(expect.stringContaining('Playback could not start'), 'error');
    });

    it('does not close a successor Play admitted during failed setup', async () => {
        fixture.ensureTrackStrips.mockImplementation(() => {
            fixture.state.current = { ...fixture.state.current!, isPlaying: true };
            throw new Error('old strip setup failed');
        });

        toggleRecording();

        await vi.waitFor(() => expect(fixture.notifyUser).toHaveBeenCalledWith(expect.any(String), 'error'));
        expect(fixture.stopAudioRecording).not.toHaveBeenCalled();
        expect(fixture.stopRecording).not.toHaveBeenCalled();
        expect(fixture.state.current).toMatchObject({ isPlaying: true, isRecording: true });
    });

    it('does not close a successor capture on the same root', async () => {
        fixture.ensureTrackStrips.mockImplementation(() => {
            recordingLifecycle.beginPendingRecordingStart();
            fixture.activeRecordingRef.current = ['successor-take'];
            throw new Error('old strip setup failed');
        });

        toggleRecording();

        await vi.waitFor(() => expect(fixture.notifyUser).toHaveBeenCalledWith(expect.any(String), 'error'));
        expect(fixture.stopAudioRecording).not.toHaveBeenCalled();
        expect(fixture.stopRecording).not.toHaveBeenCalled();
        expect(fixture.activeRecordingRef.current).toEqual(['successor-take']);
        expect(fixture.state.current).toMatchObject({ isPlaying: false, isRecording: true });
    });

    it('does not close a new root installed during failed setup', async () => {
        fixture.ensureTrackStrips.mockImplementation(() => {
            fixture.root.current = 'root-b';
            fixture.activeRecordingRef.current = ['new-root-take'];
            throw new Error('old strip setup failed');
        });

        toggleRecording();

        await vi.waitFor(() => expect(fixture.notifyUser).toHaveBeenCalledWith(expect.any(String), 'error'));
        expect(fixture.stopAudioRecording).not.toHaveBeenCalled();
        expect(fixture.stopRecording).not.toHaveBeenCalled();
        expect(fixture.activeRecordingRef.current).toEqual(['new-root-take']);
        expect(fixture.state.current).toMatchObject({ isPlaying: false, isRecording: true });
    });

    it('does not close a new root admitted during the old capture flush', async () => {
        fixture.stopAudioRecording.mockImplementation(async () => {
            fixture.root.current = 'root-b';
            fixture.activeRecordingRef.current = ['new-root-take'];
            fixture.state.current = { ...fixture.state.current!, isRecording: true, isPlaying: false };
        });

        toggleRecording();

        await vi.waitFor(() => expect(fixture.stopAudioRecording).toHaveBeenCalledOnce());
        await recordingLifecycle.waitForClosing();
        expect(fixture.stopRecording).not.toHaveBeenCalled();
        expect(fixture.activeRecordingRef.current).toEqual(['new-root-take']);
        expect(fixture.state.current).toMatchObject({ isPlaying: false, isRecording: true });
    });

    it('does not close a successor capture admitted on the same root during flush', async () => {
        fixture.stopAudioRecording.mockImplementation(async () => {
            recordingLifecycle.beginPendingRecordingStart();
            fixture.activeRecordingRef.current = ['successor-take'];
        });

        toggleRecording();

        await vi.waitFor(() => expect(fixture.stopAudioRecording).toHaveBeenCalledOnce());
        await recordingLifecycle.waitForClosing();
        expect(fixture.stopRecording).not.toHaveBeenCalled();
        expect(fixture.activeRecordingRef.current).toEqual(['successor-take']);
        expect(fixture.state.current).toMatchObject({ isPlaying: false, isRecording: true });
    });

    it('does not clear a successor Play admitted while the old take closes', async () => {
        fixture.stopRecording.mockImplementation(async () => {
            fixture.activeRecordingRef.current = [];
            fixture.state.current = { ...fixture.state.current!, isPlaying: true, isRecording: true };
            return 'closed';
        });

        toggleRecording();

        await vi.waitFor(() => expect(fixture.stopRecording).toHaveBeenCalledOnce());
        await recordingLifecycle.waitForClosing();
        expect(fixture.state.current).toMatchObject({ isPlaying: true, isRecording: true });
    });

    it('reports a failed capture flush rather than leaving its rejection unobserved', async () => {
        fixture.stopAudioRecording.mockRejectedValue(new Error('recorder flush failed'));

        toggleRecording();

        await vi.waitFor(() =>
            expect(fixture.logError).toHaveBeenCalledWith(
                expect.objectContaining({ message: 'Recording admission or cleanup failed' })
            )
        );
        expect(fixture.notifyUser).toHaveBeenCalledWith(
            expect.stringContaining('Recording could not be completed'),
            'error'
        );
        expect(fixture.stopRecording).toHaveBeenCalledOnce();
        expect(fixture.state.current).toMatchObject({ isPlaying: false, isRecording: false });
    });
});
