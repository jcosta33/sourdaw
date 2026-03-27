import { getTransportState, updateTransportState } from '#/modules/Transport/repositories/transport';
import { getTrackStoreState } from '#/modules/Arrangement/useCases/trackQueries/trackStoreAccess';
import { updateClip } from '#/modules/Arrangement/useCases/trackQueries/trackMutations';
import { resumeEngine, getAudioContext } from '#/modules/AudioEngine/useCases/engineAccess';
import { scheduleClick } from '#/modules/AudioEngine/useCases/scheduling';
import { startAudioRecording, stopAudioRecording } from '#/modules/AudioEngine/useCases/audioRecorder';
import { startRecording, stopRecording } from '#/modules/Arrangement/useCases/recording';
import { audioBufferCache } from '#/modules/AudioEngine/stores/audioBufferCache';
import { ensureTrackStrips } from '#/modules/Transport/useCases/ensureTrackStrips';
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
            void startAudioRecording(track.id, (buffer) => {
                const bufferId = `rec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                audioBufferCache.set(bufferId, buffer);

                if (recClip) {
                    updateClip(recClip.id, (c) => ({ ...c, audioBufferId: bufferId }));
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
