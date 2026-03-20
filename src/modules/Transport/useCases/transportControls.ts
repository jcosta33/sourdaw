import { getTransportState, updateTransportState } from '../repositories/transportRepository';
import { trackStore } from '#/modules/Track/stores/trackStore';
import {
    ensureTrackStrip,
    setTrackGain,
    setTrackPan,
    setTrackMute,
} from '#/modules/AudioEngine/useCases/trackAudioControls';
import { ensureBusStrip, setBusGain, setSend } from '#/modules/AudioEngine/useCases/busControls';
import { resumeEngine, getAudioContext } from '#/modules/AudioEngine/useCases/engineAccess';
import { stopAllScheduled, scheduleClick } from '#/modules/AudioEngine/useCases/scheduling';
import { startPlayheadScheduler, stopPlayheadScheduler } from './playheadScheduler';
import { startAudioRecording, stopAudioRecording } from '#/modules/AudioEngine/useCases/audioRecorder';
import { startRecording, stopRecording } from '#/modules/Track/useCases/recordingUseCases';
import { audioBufferCache } from '#/modules/AudioEngine/stores/audioBufferCache';
import { resetMidiState } from '#/modules/AudioEngine/useCases/webMidiInput';

function ensureTrackStrips(): void {
    const tracks = trackStore.value?.tracks;
    if (!tracks) {
        return;
    }

    const busTracks = tracks.filter((t) => t.kind === 'bus');
    for (const bus of busTracks) {
        ensureBusStrip(bus.id);
        setBusGain(bus.id, bus.gain);
    }

    for (const track of tracks) {
        if (track.kind === 'folder') {
            continue;
        }
        ensureTrackStrip(track.id);
        setTrackGain(track.id, track.gain);
        setTrackPan(track.id, track.pan);
        setTrackMute(track.id, track.muted, track.gain);

        for (const send of track.sends) {
            setSend(track.id, send.busId, send.level, send.preFader);
        }
    }
}

export function togglePlayback(): void {
    const state = getTransportState();
    if (!state) {
        return;
    }

    if (state.isPlaying) {
        stopPlayback();
    } else {
        startPlayback();
    }
}

export function startPlayback(): void {
    const state = getTransportState();
    if (!state) {
        return;
    }

    void resumeEngine();
    ensureTrackStrips();

    let startPosition = state.playheadPosition;
    if (state.preRollEnabled && state.preRollBars > 0) {
        const preRollBeats = state.preRollBars * state.timeSignatureNumerator;
        startPosition = Math.max(0, startPosition - preRollBeats);
    }

    updateTransportState({ isPlaying: true, playheadPosition: startPosition });
    startPlayheadScheduler();
}

export function stopPlayback(): void {
    const state = getTransportState();
    if (!state) {
        return;
    }

    stopPlayheadScheduler();
    stopAllScheduled();
    resetMidiState();
    updateTransportState({ isPlaying: false, isRecording: false, playheadPosition: 0 });
}

export function toggleLoop(): void {
    const state = getTransportState();
    if (!state) {
        return;
    }
    updateTransportState({ isLooping: !state.isLooping });
}

export function toggleOverdub(): void {
    const state = getTransportState();
    if (!state) {
        return;
    }
    updateTransportState({ overdubEnabled: !state.overdubEnabled });
}

export function toggleMetronome(): void {
    const state = getTransportState();
    if (!state) {
        return;
    }
    updateTransportState({ metronomeEnabled: !state.metronomeEnabled });
}

export function setMetronomeVolume(volume: number): void {
    const state = getTransportState();
    if (!state) {
        return;
    }
    updateTransportState({ metronomeVolume: Math.max(0, Math.min(1, volume)) });
}

export function setLoopRegion(startBeat: number, endBeat: number): void {
    const state = getTransportState();
    if (!state) {
        return;
    }
    updateTransportState({ loopStart: startBeat, loopEnd: endBeat });
}

export function setPunchIn(beat: number): void {
    const state = getTransportState();
    if (!state) {
        return;
    }
    updateTransportState({ punchInBeat: Math.max(0, beat) });
}

export function setPunchOut(beat: number): void {
    const state = getTransportState();
    if (!state) {
        return;
    }
    updateTransportState({ punchOutBeat: Math.max(0, beat) });
}

export function togglePunchEnabled(): void {
    const state = getTransportState();
    if (!state) {
        return;
    }
    updateTransportState({ punchInEnabled: !state.punchInEnabled });
}

export function toggleCountIn(): void {
    const state = getTransportState();
    if (!state) {
        return;
    }
    updateTransportState({ countInEnabled: !state.countInEnabled });
}

export function setCountInBars(bars: number): void {
    const state = getTransportState();
    if (!state) {
        return;
    }
    updateTransportState({ countInBars: Math.max(1, Math.min(8, bars)) });
}

export function togglePreRoll(): void {
    const state = getTransportState();
    if (!state) {
        return;
    }
    updateTransportState({ preRollEnabled: !state.preRollEnabled });
}

export function setPreRollBars(bars: number): void {
    const state = getTransportState();
    if (!state) {
        return;
    }
    updateTransportState({ preRollBars: Math.max(1, Math.min(8, bars)) });
}

let activeRecordingClipIds: string[] = [];
let countInTimerId: ReturnType<typeof setTimeout> | null = null;

function beginActualRecording(): void {
    const clips = startRecording();
    activeRecordingClipIds = clips.map((c) => c.id);
    updateTransportState({ isRecording: true });

    const armedTracks = trackStore.value?.tracks.filter((t) => t.armed) ?? [];
    for (const track of armedTracks) {
        if (track.kind === 'audio') {
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
                                    c.id === recClip.id ? { ...c, audioBufferId: bufferId } : c
                                ),
                            })),
                        });
                    }
                }
            });
        }
    }
}

export function toggleRecording(): void {
    const state = getTransportState();
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
        updateTransportState({ isRecording: false });
        return;
    }

    if (state.punchInEnabled) {
        updateTransportState({ isRecording: false });
        if (!state.isPlaying) {
            startPlayback();
        }
        return;
    }

    if (state.countInEnabled && state.countInBars > 0) {
        const beatsPerBar = state.timeSignatureNumerator;
        const countInBeats = state.countInBars * beatsPerBar;
        const countInDurationSec = countInBeats / (state.tempo / 60);

        void resumeEngine();
        ensureTrackStrips();

        const ctx = getAudioContext();
        for (let i = 0; i < countInBeats; i++) {
            const time = ctx.currentTime + i / (state.tempo / 60);
            scheduleClick(time, i % beatsPerBar === 0, state.metronomeVolume ?? 0.5);
        }

        countInTimerId = setTimeout(() => {
            countInTimerId = null;
            beginActualRecording();
            const current = getTransportState();
            if (current && !current.isPlaying) {
                startPlayback();
            }
        }, countInDurationSec * 1000);
        return;
    }

    beginActualRecording();

    if (!state.isPlaying) {
        startPlayback();
    }
}

export function seekPlayhead(beat: number): void {
    const state = getTransportState();
    if (!state) {
        return;
    }
    updateTransportState({ playheadPosition: Math.max(0, beat) });
}
