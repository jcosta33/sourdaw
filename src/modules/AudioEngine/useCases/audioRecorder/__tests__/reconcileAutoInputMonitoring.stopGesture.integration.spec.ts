import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { trackStore, type Track } from '#/modules/Arrangement/stores';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';
import { stopPlayback, togglePlayback, toggleRecording } from '#/modules/Transport/useCases';

import { reconcileAutoInputMonitoring } from '../reconcileAutoInputMonitoring';
import { syncAutoInputMonitoring } from '../syncAutoInputMonitoring';

const TRACK_ID = 'track-armed-auto';
const INPUT_ID = 'input-1';

const harness = vi.hoisted(() => ({
    monitored: new Map<string, string | null>(),
    startInputMonitoring: vi.fn<(trackId: string, inputId: string | null) => Promise<boolean>>(),
    stopTrackInputMonitoring: vi.fn<(trackId: string) => void>(),
}));

// Only the monitor edge leaves and the audio side effects of a stop are replaced.
// The owner, its subscriptions, the real Stop, Pause and Record use cases and
// the stores are real.
vi.mock('../startInputMonitoring', () => ({ startInputMonitoring: harness.startInputMonitoring }));
vi.mock('../stopTrackInputMonitoring', () => ({ stopTrackInputMonitoring: harness.stopTrackInputMonitoring }));
vi.mock('../../../repositories/audioRecorder/isTrackInputMonitored', () => ({
    isTrackInputMonitored: (trackId: string, inputId: string | null) =>
        harness.monitored.has(trackId) && harness.monitored.get(trackId) === inputId,
}));
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    audioEngine: { setTransportInfo: vi.fn() },
    getAudioContext: vi.fn(() => ({ currentTime: 1, sampleRate: 48000 })),
    stopAllScheduled: vi.fn(),
    stopAudioRecording: vi.fn(() => Promise.resolve()),
    stopNativeLiveGraphSession: vi.fn(() => Promise.resolve({ outcome: 'declined', reason: 'no session' })),
}));
vi.mock('#/modules/MIDI/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/useCases')>()),
    resetMidiState: vi.fn(),
}));
vi.mock('#/modules/Yeast/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Yeast/useCases')>()),
    yeastPanic: vi.fn(() => Promise.resolve()),
}));

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
        inputId: INPUT_ID,
        activeAlternativeId: 'alt-1',
        alternatives: [{ id: 'alt-1', name: 'Alternative 1', clips: [] }],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
        midiFx: [],
    };
}

function setTransport(patch: { isPlaying: boolean; isRecording: boolean }): void {
    transportStore.set({ ...defaultTransportState, ...patch, playheadPosition: 4 });
}

describe('Auto input monitoring across the Stop gestures', () => {
    let unsubscribe: () => void;

    beforeEach(() => {
        harness.monitored.clear();
        harness.startInputMonitoring.mockReset();
        harness.stopTrackInputMonitoring.mockReset();
        harness.startInputMonitoring.mockImplementation((trackId, inputId) => {
            harness.monitored.set(trackId, inputId);
            return Promise.resolve(true);
        });
        harness.stopTrackInputMonitoring.mockImplementation((trackId) => {
            harness.monitored.delete(trackId);
        });
        trackStore.set({ tracks: [armedAutoAudioTrack()], selectedTrackId: null, ghostClips: [] });
        setTransport({ isPlaying: false, isRecording: false });
        unsubscribe = syncAutoInputMonitoring();
    });

    afterEach(() => {
        unsubscribe();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        reconcileAutoInputMonitoring();
    });

    function startRecordingRoll(): void {
        setTransport({ isPlaying: true, isRecording: true });
        expect(harness.monitored.get(TRACK_ID)).toBe(INPUT_ID);
        harness.startInputMonitoring.mockClear();
        harness.stopTrackInputMonitoring.mockClear();
    }

    function startPlainPlaybackRoll(): void {
        setTransport({ isPlaying: true, isRecording: false });
        expect(harness.monitored.has(TRACK_ID)).toBe(false);
        harness.startInputMonitoring.mockClear();
        harness.stopTrackInputMonitoring.mockClear();
    }

    it('keeps the armed Auto edge untouched when one Stop ends a recording', async () => {
        startRecordingRoll();

        await stopPlayback();

        expect(transportStore.value).toMatchObject({ isPlaying: false, isRecording: false });
        expect(harness.stopTrackInputMonitoring).not.toHaveBeenCalled();
        expect(harness.startInputMonitoring).not.toHaveBeenCalled();
        expect(harness.monitored.get(TRACK_ID)).toBe(INPUT_ID);
    });

    it('closes the edge when a punch-out ends the recording while playback continues', () => {
        startRecordingRoll();

        toggleRecording();

        expect(transportStore.value).toMatchObject({ isPlaying: true, isRecording: false });
        expect(harness.stopTrackInputMonitoring).toHaveBeenCalledExactlyOnceWith(TRACK_ID);
        expect(harness.monitored.has(TRACK_ID)).toBe(false);
    });

    it('opens the edge when Stop ends plain playback', async () => {
        startPlainPlaybackRoll();

        await stopPlayback();

        expect(harness.startInputMonitoring).toHaveBeenCalledExactlyOnceWith(TRACK_ID, INPUT_ID);
        expect(harness.monitored.get(TRACK_ID)).toBe(INPUT_ID);
    });

    it('opens the edge when Pause ends plain playback', () => {
        startPlainPlaybackRoll();

        togglePlayback();

        expect(harness.startInputMonitoring).toHaveBeenCalledExactlyOnceWith(TRACK_ID, INPUT_ID);
        expect(harness.monitored.get(TRACK_ID)).toBe(INPUT_ID);
    });

    it('keeps the armed Auto edge untouched when Pause ends a recording', () => {
        startRecordingRoll();

        togglePlayback();

        expect(transportStore.value).toMatchObject({ isPlaying: false, isRecording: false });
        expect(harness.stopTrackInputMonitoring).not.toHaveBeenCalled();
        expect(harness.startInputMonitoring).not.toHaveBeenCalled();
    });
});
