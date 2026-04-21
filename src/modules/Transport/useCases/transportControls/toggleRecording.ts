import { getTrackStoreState, updateClip, startRecording, stopRecording } from '#/modules/Arrangement/useCases';
import { audioBufferCache } from '#/modules/AudioEngine/stores';
import {
    resumeEngine,
    getAudioContext,
    scheduleClick,
    startAudioRecording,
    stopAudioRecording,
    getCompensationDelay,
} from '#/modules/AudioEngine/useCases';

import { getTransportState } from '../../repositories/transport/getTransportState';
import { updateTransportState } from '../../repositories/transport/updateTransportState';
import { ensureTrackStrips } from '../ensureTrackStrips';

import { startPlayback } from './startPlayback';

let countInTimerId: ReturnType<typeof setTimeout> | null = null;

function beginActualRecording(): void {
    const clips = startRecording();
    updateTransportState({ isRecording: true });

    const ctx = getAudioContext();
    const totalHardwareLatencySec = (ctx.baseLatency || 0) + (ctx.outputLatency || 0);

    const armedTracks = getTrackStoreState()?.tracks.filter((t) => t.armed) ?? [];
    for (const track of armedTracks) {
        if (track.kind === 'audio') {
            const trackLatencySec = getCompensationDelay(track.id);
            const totalLatencySec = totalHardwareLatencySec + trackLatencySec;

            const recClip = clips.find((c) => c.trackId === track.id);
            startAudioRecording(track.id, (buffer) => {
                const bufferId = `rec-${crypto.randomUUID()}`;
                audioBufferCache.set(bufferId, buffer);

                if (recClip) {
                    const transport = getTransportState();
                    const bpm = transport?.tempo ?? 120;

                    const offsetBeats = totalLatencySec * (bpm / 60);
                    const newStartBeat = Math.max(0, recClip.startBeat - offsetBeats);
                    const durationBeats = buffer.duration * (bpm / 60);
                    const exactEndBeat = newStartBeat + durationBeats;

                    // Update in one go
                    Promise.resolve().then(() => {
                        updateClip(recClip.id, (c) => ({
                            ...c,
                            audioBufferId: bufferId,
                            startBeat: newStartBeat,
                            endBeat: exactEndBeat,
                        }));
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
        stopRecording();
        if (countInTimerId !== null) {
            clearTimeout(countInTimerId);
            countInTimerId = null;
        }
        updateTransportState({ isRecording: false });
        return;
    }

    if (state.punchInEnabled) {
        // Punch-in: start recording immediately and begin playback.
        // The punch-in/out points are enforced by the scheduler, which
        // only writes audio between the in/out markers.
        beginActualRecording();
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
 }
}
