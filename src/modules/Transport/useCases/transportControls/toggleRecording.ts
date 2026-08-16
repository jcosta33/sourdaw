import { logger } from '#/infra/logger/appLogger';
import { getTrackStoreState, updateClip, startRecording } from '#/modules/Arrangement/useCases';
import {
    resumeEngine,
    getAudioContext,
    scheduleClick,
    startAudioRecording,
    stopAudioRecording,
    getCompensationDelay,
    cacheAudioBuffer,
} from '#/modules/AudioEngine/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { getTimeSignatureAtBeat } from '../../models/TimeSignatureMap';
import { getTransportState } from '../../repositories/transport/getTransportState';
import { updateTransportState } from '../../repositories/transport/updateTransportState';
import { playheadPositionRef } from '../../stores/playheadPositionRef';
import { timeSignatureMapStore } from '../../stores/timeSignatureMapStore';
import { ensureTrackStrips } from '../ensureTrackStrips';

import { recordingLifecycle } from './recordingLifecycle';
import { startPlayback } from './startPlayback';
import { stopActiveRecording } from './stopActiveRecording';

async function beginActualRecording(startToken: number): Promise<boolean> {
    const ctx = getAudioContext();
    const totalHardwareLatencySec = (ctx.baseLatency || 0) + (ctx.outputLatency || 0);
    const armedTracks = getTrackStoreState()?.tracks.filter((time) => time.armed) ?? [];
    const audioTracks = armedTracks.filter((track) => track.kind === 'audio');
    let clips: ReturnType<typeof startRecording> = [];

    const recordingStarts = audioTracks.map((track) => {
        const trackLatencySec = getCompensationDelay(track.id);
        const totalLatencySec = totalHardwareLatencySec + trackLatencySec;

        return startAudioRecording(track.id, (buffer) => {
            const recClip = clips.find((context) => context.trackId === track.id);
            if (recClip) {
                const bufferId = `rec-${crypto.randomUUID()}`;
                cacheAudioBuffer({ buffer, bufferId });

                const transport = getTransportState();
                const bpm = transport?.tempo ?? 120;
                const offsetBeats = totalLatencySec * (bpm / 60);
                const newStartBeat = Math.max(0, recClip.startBeat - offsetBeats);
                const durationBeats = buffer.duration * (bpm / 60);
                const exactEndBeat = newStartBeat + durationBeats;

                void Promise.resolve().then(() => {
                    updateClip(recClip.id, (context) => ({
                        ...context,
                        audioBufferId: bufferId,
                        startBeat: newStartBeat,
                        endBeat: exactEndBeat,
                    }));
                    return null;
                });
            }
        });
    });

    if (recordingStarts.length > 0) {
        const started = await Promise.all(recordingStarts);
        if (!recordingLifecycle.ownsPendingRecordingStart(startToken)) {
            return false;
        }
        if (started.some((didStart) => !didStart)) {
            recordingLifecycle.completePendingRecordingStart(startToken);
            await stopAudioRecording();
            notifyUser('Unable to start recording. Check the selected audio input.', 'error');
            return false;
        }
    }

    if (!recordingLifecycle.completePendingRecordingStart(startToken)) {
        await stopAudioRecording();
        return false;
    }
    // Record engaged while the transport is already rolling: anchor the clips at
    // the live playhead. The transport store is written on discrete events only,
    // so during playback its `playheadPosition` still holds the beat playback
    // started at — `startRecording`'s default would open the clip back there.
    const rolling = getTransportState()?.isPlaying === true;
    clips = startRecording(rolling ? playheadPositionRef.current : undefined);
    updateTransportState({ isRecording: true });
    return true;
}

function beginRecordingAndMaybePlayback(): void {
    const startToken = recordingLifecycle.beginPendingRecordingStart();
    void beginActualRecording(startToken).then((started) => {
        const current = getTransportState();
        if (started && current && !current.isPlaying) {
            startPlayback();
        }
        return null;
    });
}

export function toggleRecording(): void {
    const state = getTransportState();
    if (!state) {
        return;
    }

    if (recordingLifecycle.hasPendingRecordingStart()) {
        void stopActiveRecording();
        return;
    }

    if (state.isRecording) {
        void stopActiveRecording();
        return;
    }

    if (state.punchInEnabled && state.punchOutBeat > state.punchInBeat) {
        // Punch arming, not recording. The scheduler owns the record window
        // (`startPlayheadScheduler`: punch-in at `punchInBeat`, punch-out at
        // `punchOutBeat`), and its punch-in branch is gated on
        // `!current.isRecording`. Opening the recording here therefore both
        // anchored the capture at the playhead instead of `punchInBeat` and
        // left `punchRecordingActive` false, which is the flag the punch-out
        // branch reads — so it also never punched out. Rolling the transport
        // and standing back is what makes the region govern both ends.
        //
        // A degenerate region (`punchOutBeat <= punchInBeat`) is excluded: the
        // scheduler refuses to punch on it, so diverting would leave Record
        // with no path to a recording at all.
        if (!state.isPlaying) {
            startPlayback();
        }
        return;
    }

    if (state.countInEnabled && state.countInBars > 0) {
        // The count-in leads into the beat where recording begins, so resolve
        // the meter at the playhead rather than using the flat
        // `timeSignatureNumerator`. A project that changes time signature at
        // the record point would otherwise count in (and accent) in the wrong
        // meter.
        const { numerator } = getTimeSignatureAtBeat(
            timeSignatureMapStore.value?.changes ?? [],
            state.playheadPosition,
            state.timeSignatureNumerator,
            state.timeSignatureDenominator
        );
        const beatsPerBar = numerator;
        const countInBeats = state.countInBars * beatsPerBar;
        const countInDurationSec = countInBeats / (state.tempo / 60);

        // Surface a failed resume rather than swallowing it: if the context stays
        // suspended the count-in clicks are inaudible, so warn the user to re-arm.
        Promise.resolve(resumeEngine()).catch((error: unknown) => {
            logger.warn(new Error('Audio engine resume failed on count-in', { cause: error }));
            notifyUser('Audio is still suspended — click anywhere to enable sound.', 'warning');
        });
        ensureTrackStrips();

        const ctx = getAudioContext();
        for (let index = 0; index < countInBeats; index++) {
            const time = ctx.currentTime + index / (state.tempo / 60);
            scheduleClick(time, index % beatsPerBar === 0, state.metronomeVolume ?? 0.5);
        }

        const timerId = setTimeout(() => {
            recordingLifecycle.setCountInTimerId(null);
            beginRecordingAndMaybePlayback();
        }, countInDurationSec * 1000);
        recordingLifecycle.setCountInTimerId(timerId);
        return;
    }

    beginRecordingAndMaybePlayback();
}
