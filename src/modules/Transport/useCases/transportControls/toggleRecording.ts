import { getTransportState } from '../../repositories/transport/getTransportState';
import { updateTransportState } from '../../repositories/transport/updateTransportState';
import { getTrackStoreState, updateClip, startRecording, stopRecording } from '#/modules/Arrangement/useCases';
import { audioBufferCache } from '#/modules/AudioEngine/stores';
import {
    resumeEngine,
    getAudioContext,
    scheduleClick,
    startAudioRecording,
    stopAudioRecording,
} from '#/modules/AudioEngine/useCases';
import { ensureTrackStrips } from '../ensureTrackStrips';
import { startPlayback } from './startPlayback';

let activeRecordingClipIds: string[] = [];
let countInTimerId: ReturnType<typeof setTimeout> | null = null;

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
}
