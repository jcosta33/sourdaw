import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { trackStore, type Track } from '#/modules/Arrangement/stores';
import {
    reconcileAutoInputMonitoring,
    stopInputMonitoring,
    syncAutoInputMonitoring,
} from '#/modules/AudioEngine/useCases';

import { defaultTransportState, transportStore } from '../../../stores/transportStore';
import { toggleRecording } from '../toggleRecording';

const TRACK_ID = 'track-armed-auto';

const mocks = vi.hoisted(() => ({
    getUserMedia: vi.fn<(constraints: MediaStreamConstraints) => Promise<MediaStream>>(),
    notifyUser: vi.fn<(message: string, level: string) => void>(),
    startPlayback: vi.fn<() => Promise<void>>(() => Promise.resolve()),
}));

// The owner, the stores, the monitor use cases and their repository are real, and
// the microphone is the only thing replaced: `getUserMedia` calls are the
// observable of an open being requested. Recording admission itself is stubbed
// at the barrel, which is the seam Transport reaches the recorder through.
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    getAudioContext: vi.fn(() => ({ currentTime: 0, baseLatency: 0, outputLatency: 0 })),
    getCompensationDelay: vi.fn(() => 0),
    startAudioRecording: vi.fn(() => Promise.resolve(true)),
    stopAudioRecording: vi.fn(() => Promise.resolve()),
}));
vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/useCases')>()),
    startRecording: vi.fn(() => []),
}));
vi.mock('../startPlayback', () => ({ startPlayback: mocks.startPlayback }));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mocks.notifyUser }));

const originalMediaDevices = globalThis.navigator.mediaDevices;

/** Field-identical replica of Arrangement's TrackDummy fixture; specs keep their own copy. */
function armedAutoAudioTrack(): Track {
    return {
        id: TRACK_ID,
        name: 'Audio',
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: true,
        gain: 0.8,
        pan: 0,
        color: '#ff0000',
        clips: [],
        devices: [],
        sends: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 80,
        outputId: 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: 'input-1',
        activeAlternativeId: 'alt-1',
        alternatives: [{ id: 'alt-1', name: 'Alternative 1', clips: [] }],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
        midiFx: [],
    };
}

function setStoppedTransport(): void {
    transportStore.set({
        ...defaultTransportState,
        isPlaying: false,
        isRecording: false,
        countInEnabled: false,
        punchInEnabled: false,
    });
}

/**
 * Lets every promise reaction already queued run, which is when the owner
 * learns the outcome of an open. A timer fires only after the microtask queue
 * has drained, so this waits for completion rather than counting turns.
 */
function drainSettledOpens(): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, 0);
    });
}

describe('Auto input monitoring retries a refused open at the Record gesture', () => {
    let unsubscribe: () => void;

    beforeEach(() => {
        Object.defineProperty(globalThis.navigator, 'mediaDevices', {
            value: { getUserMedia: mocks.getUserMedia },
            configurable: true,
        });
        stopInputMonitoring();
        mocks.getUserMedia.mockReset();
        // The first request is refused; any later one stays pending, so a retry
        // is observable without ever connecting an edge.
        mocks.getUserMedia.mockRejectedValueOnce(new Error('NotAllowedError'));
        mocks.getUserMedia.mockReturnValue(new Promise<MediaStream>(() => undefined));
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        setStoppedTransport();
        reconcileAutoInputMonitoring();
        trackStore.set({ tracks: [armedAutoAudioTrack()], selectedTrackId: TRACK_ID, ghostClips: [] });
        unsubscribe = syncAutoInputMonitoring();
    });

    afterEach(() => {
        unsubscribe();
        stopInputMonitoring();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        reconcileAutoInputMonitoring();
        Object.defineProperty(globalThis.navigator, 'mediaDevices', {
            value: originalMediaDevices,
            configurable: true,
        });
    });

    it('does not re-request a refused open on publications that start no recording', async () => {
        await drainSettledOpens();
        expect(mocks.getUserMedia).toHaveBeenCalledTimes(1);

        trackStore.set({ ...trackStore.value!, tracks: [{ ...armedAutoAudioTrack(), name: 'Renamed' }] });
        setStoppedTransport();

        expect(mocks.getUserMedia).toHaveBeenCalledTimes(1);
    });

    it('retries the refused open exactly once when Record starts the recording from stop', async () => {
        await drainSettledOpens();
        expect(mocks.getUserMedia).toHaveBeenCalledTimes(1);

        toggleRecording();
        await vi.waitFor(() => {
            expect(transportStore.value?.isRecording).toBe(true);
        });
        await drainSettledOpens();

        expect(mocks.getUserMedia).toHaveBeenCalledTimes(2);
    });
});
