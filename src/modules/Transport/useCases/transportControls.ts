import { transportStore } from "../stores/transportStore";
import { trackStore } from "#/modules/Track/stores/trackStore";
import { audioEngine } from "#/modules/AudioEngine/repositories/audioEngineInstance";
import { startPlayheadScheduler, stopPlayheadScheduler } from "./playheadScheduler";
import { startAudioRecording, stopAudioRecording } from "#/modules/AudioEngine/useCases/audioRecorder";
import { startRecording, stopRecording } from "#/modules/Track/useCases/recordingUseCases";
import { audioBufferCache } from "#/modules/AudioEngine/stores/audioBufferCache";
import { resetMidiState } from "#/modules/AudioEngine/useCases/webMidiInput";

const ensureTrackStrips = (): void => {
    const tracks = trackStore.value?.tracks;
    if (!tracks) {
        return;
    }

    const busTracks = tracks.filter((t) => t.kind === "bus");
    for (const bus of busTracks) {
        audioEngine.ensureBusStrip(bus.id);
        audioEngine.setBusGain(bus.id, bus.gain);
    }

    for (const track of tracks) {
        if (track.kind === "folder") {
            continue;
        }
        audioEngine.ensureTrackStrip(track.id);
        audioEngine.setTrackGain(track.id, track.gain);
        audioEngine.setTrackPan(track.id, track.pan);
        audioEngine.setTrackMute(track.id, track.muted, track.gain);

        for (const send of track.sends) {
            audioEngine.setSend(track.id, send.busId, send.level, send.preFader);
        }
    }
};

export const togglePlayback = (): void => {
    const state = transportStore.value;
    if (!state) {
        return;
    }

    if (state.isPlaying) {
        stopPlayback();
    } else {
        startPlayback();
    }
};

export const startPlayback = (): void => {
    const state = transportStore.value;
    if (!state) {
        return;
    }

    void audioEngine.resume();
    ensureTrackStrips();

    let startPosition = state.playheadPosition;
    if (state.preRollEnabled && state.preRollBars > 0) {
        const preRollBeats = state.preRollBars * state.timeSignatureNumerator;
        startPosition = Math.max(0, startPosition - preRollBeats);
    }

    transportStore.set({ ...state, isPlaying: true, playheadPosition: startPosition });
    startPlayheadScheduler();
};

export const stopPlayback = (): void => {
    const state = transportStore.value;
    if (!state) {
        return;
    }

    stopPlayheadScheduler();
    audioEngine.stopAllScheduled();
    resetMidiState();
    transportStore.set({ ...state, isPlaying: false, isRecording: false, playheadPosition: 0 });
};

export const toggleLoop = (): void => {
    const state = transportStore.value;
    if (!state) {
        return;
    }
    transportStore.set({ ...state, isLooping: !state.isLooping });
};

export const toggleMetronome = (): void => {
    const state = transportStore.value;
    if (!state) {
        return;
    }
    transportStore.set({ ...state, metronomeEnabled: !state.metronomeEnabled });
};

export const setMetronomeVolume = (volume: number): void => {
    const state = transportStore.value;
    if (!state) {
        return;
    }
    transportStore.set({ ...state, metronomeVolume: Math.max(0, Math.min(1, volume)) });
};

export const setLoopRegion = (startBeat: number, endBeat: number): void => {
    const state = transportStore.value;
    if (!state) {
        return;
    }
    transportStore.set({ ...state, loopStart: startBeat, loopEnd: endBeat });
};

export const setPunchIn = (beat: number): void => {
    const state = transportStore.value;
    if (!state) {
        return;
    }
    transportStore.set({ ...state, punchInBeat: Math.max(0, beat) });
};

export const setPunchOut = (beat: number): void => {
    const state = transportStore.value;
    if (!state) {
        return;
    }
    transportStore.set({ ...state, punchOutBeat: Math.max(0, beat) });
};

export const togglePunchEnabled = (): void => {
    const state = transportStore.value;
    if (!state) {
        return;
    }
    transportStore.set({ ...state, punchInEnabled: !state.punchInEnabled });
};

export const toggleCountIn = (): void => {
    const state = transportStore.value;
    if (!state) {
        return;
    }
    transportStore.set({ ...state, countInEnabled: !state.countInEnabled });
};

export const setCountInBars = (bars: number): void => {
    const state = transportStore.value;
    if (!state) {
        return;
    }
    transportStore.set({ ...state, countInBars: Math.max(1, Math.min(8, bars)) });
};

export const togglePreRoll = (): void => {
    const state = transportStore.value;
    if (!state) {
        return;
    }
    transportStore.set({ ...state, preRollEnabled: !state.preRollEnabled });
};

export const setPreRollBars = (bars: number): void => {
    const state = transportStore.value;
    if (!state) {
        return;
    }
    transportStore.set({ ...state, preRollBars: Math.max(1, Math.min(8, bars)) });
};

let activeRecordingClipIds: string[] = [];
let countInTimerId: ReturnType<typeof setTimeout> | null = null;

const beginActualRecording = (state: NonNullable<typeof transportStore.value>): void => {
    const clips = startRecording();
    activeRecordingClipIds = clips.map((c) => c.id);
    transportStore.set({ ...transportStore.value!, isRecording: true });

    const armedTracks = trackStore.value?.tracks.filter((t) => t.armed) ?? [];
    for (const track of armedTracks) {
        if (track.kind === "audio") {
            const recClip = clips.find((c) => c.trackId === track.id);
            void startAudioRecording(track.id, (buffer) => {
                const bufferId = `rec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                audioBufferCache.set(bufferId, buffer);

                if (recClip) {
                    const ts = trackStore.value;
                    if (ts) {
                        trackStore.set({
                            ...ts,
                            tracks: ts.tracks.map((t) => ({
                                ...t,
                                clips: t.clips.map((c) =>
                                    c.id === recClip.id ? { ...c, audioBufferId: bufferId } : c,
                                ),
                            })),
                        });
                    }
                }
            });
        }
    }

    void state;
};

export const toggleRecording = (): void => {
    const state = transportStore.value;
    if (!state) {
        return;
    }

    if (state.isRecording) {
        stopAudioRecording();
        stopRecording(activeRecordingClipIds);
        activeRecordingClipIds = [];
        if (countInTimerId !== null) {
            clearTimeout(countInTimerId);
            countInTimerId = null;
        }
        transportStore.set({ ...state, isRecording: false });
        return;
    }

    if (state.punchInEnabled) {
        transportStore.set({ ...state, isRecording: false });
        if (!state.isPlaying) {
            startPlayback();
        }
        return;
    }

    if (state.countInEnabled && state.countInBars > 0) {
        const beatsPerBar = state.timeSignatureNumerator;
        const countInBeats = state.countInBars * beatsPerBar;
        const countInDurationSec = countInBeats / (state.tempo / 60);

        void audioEngine.resume();
        ensureTrackStrips();

        const ctx = audioEngine.context;
        for (let i = 0; i < countInBeats; i++) {
            const time = ctx.currentTime + i / (state.tempo / 60);
            audioEngine.scheduleClick(time, i % beatsPerBar === 0, state.metronomeVolume ?? 0.5);
        }

        countInTimerId = setTimeout(() => {
            countInTimerId = null;
            beginActualRecording(transportStore.value!);
            if (!transportStore.value?.isPlaying) {
                startPlayback();
            }
        }, countInDurationSec * 1000);
        return;
    }

    beginActualRecording(state);

    if (!state.isPlaying) {
        startPlayback();
    }
};

export const seekPlayhead = (beat: number): void => {
    const state = transportStore.value;
    if (!state) {
        return;
    }
    transportStore.set({
        ...state,
        playheadPosition: Math.max(0, beat),
    });
};
