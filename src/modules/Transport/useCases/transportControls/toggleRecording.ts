import { inject } from '#/infra/di/inject';
import { getTransportState, updateTransportState } from '#/modules/Transport/repositories/transport';
import {
    getTrackStoreState,
    updateClip,
    startRecording,
    stopRecording,
} from '#/modules/Arrangement';
import {
    resumeEngine,
    getAudioContext,
    scheduleClick,
    startAudioRecording,
    stopAudioRecording,
    audioBufferCache,
} from '#/modules/AudioEngine';
import { ensureTrackStrips } from '#/modules/Transport/useCases/ensureTrackStrips';
import { startPlayback } from './startPlayback';

let activeRecordingClipIds: string[] = [];
let countInTimerId: ReturnType<typeof setTimeout> | null = null;

export const toggleRecording = inject(
    {
        getTransportState,
        updateTransportState,
        get getTrackStoreState() {
            return getTrackStoreState;
        },
        get updateClip() {
            return updateClip;
        },
        get resumeEngine() {
            return resumeEngine;
        },
        get getAudioContext() {
            return getAudioContext;
        },
        get scheduleClick() {
            return scheduleClick;
        },
        get startAudioRecording() {
            return startAudioRecording;
        },
        get stopAudioRecording() {
            return stopAudioRecording;
        },
        get startRecording() {
            return startRecording;
        },
        get stopRecording() {
            return stopRecording;
        },
        get audioBufferCache() {
            return audioBufferCache;
        },
        ensureTrackStrips,
        startPlayback,
    },
    { lazy: true }
)(
    ({
        getTransportState,
        updateTransportState,
        getTrackStoreState,
        updateClip,
        resumeEngine,
        getAudioContext,
        scheduleClick,
        startAudioRecording,
        stopAudioRecording,
        startRecording,
        stopRecording,
        audioBufferCache,
        ensureTrackStrips,
        startPlayback,
    }) => {
        function beginActualRecording(): void {
            const clips = startRecording();
            activeRecordingClipIds = clips.map((c) => c.id);
            updateTransportState({ isRecording: true });

            const armedTracks = getTrackStoreState()?.tracks.filter((t) => t.armed) ?? [];
            for (const track of armedTracks) {
                if (track.kind === 'audio') {
                    const recClip = clips.find((c) => c.trackId === track.id);
                    startAudioRecording(track.id, (buffer) => {
                        const bufferId = `rec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                        audioBufferCache.set(bufferId, buffer);

                        if (recClip) {
                            updateClip(recClip.id, (c) => ({ ...c, audioBufferId: bufferId }));

                            const transport = getTransportState();
                            const bpm = transport?.tempo ?? 120;
                            const durationBeats = buffer.duration * (bpm / 60);
                            const exactEndBeat = recClip.startBeat + durationBeats;
                            Promise.resolve().then(() => {
                                updateClip(recClip.id, (c) => ({ ...c, endBeat: exactEndBeat }));
                            });
                        }
                    });
                }
            }
        }

        return function toggleRecording(): void {
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

                resumeEngine();
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
        };
    }
);
