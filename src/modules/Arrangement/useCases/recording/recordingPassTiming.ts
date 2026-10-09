import { playheadClockRef, readSecondsAtBeat, transportStore } from '#/modules/Transport/stores';

import { placeTakeOnClipMedia, type Take } from '../../models/TakeLane';
import { liveTempoTimeline } from '../liveTempoTimeline';

type PassStart = { contextSeconds: number } | { songSeconds: number };
type RecordingPassTiming = {
    recordPointBeat: number;
    firstPassClock: (() => number | null) | undefined;
    recordPointContextSeconds: number | null;
    runUpSeconds: number;
    previousSeamContextSeconds: number | null;
    starts: Map<string, PassStart>;
};

// Capture-clock witnesses belong to a provisional recording, never project truth.
const recordingPassTimings = new Map<string, RecordingPassTiming>();

function beginRecordingPassTiming(clipId: string, recordPointBeat: number, firstPassClock?: () => number | null): void {
    const transport = transportStore.value;
    if (!transport) {
        return;
    }
    const seconds = (beat: number): number => readSecondsAtBeat({ beat });
    const recordPointSeconds = seconds(recordPointBeat);
    const firstPassBeat = Math.max(recordPointBeat, transport.loopStart);
    let recordPointContextSeconds: number | null = null;
    if (transport.isPlaying) {
        recordPointContextSeconds =
            playheadClockRef.audioTimeSeconds + recordPointSeconds - seconds(playheadClockRef.beat);
    }
    recordingPassTimings.set(clipId, {
        recordPointBeat,
        firstPassClock,
        recordPointContextSeconds,
        runUpSeconds: seconds(firstPassBeat) - recordPointSeconds,
        previousSeamContextSeconds: null,
        starts: new Map(),
    });
}

function stageRecordingPassTiming(take: Take, passEndContextSeconds?: number): void {
    const timing = recordingPassTimings.get(take.clipId);
    if (!timing || take.sourceOffsetBeats === undefined) {
        return;
    }
    if (passEndContextSeconds !== undefined) {
        let firstStart = timing.firstPassClock?.() ?? null;
        if (firstStart === null && timing.recordPointContextSeconds !== null) {
            firstStart = timing.recordPointContextSeconds + timing.runUpSeconds;
        }
        if (firstStart === null) {
            throw new Error('Recording pass has no rolling capture clock');
        }
        timing.starts.set(take.id, {
            contextSeconds: timing.previousSeamContextSeconds ?? firstStart,
        });
        timing.previousSeamContextSeconds = passEndContextSeconds;
        return;
    }
    // Musical-only staging freezes its conversion before the capture flush.
    const placed = placeTakeOnClipMedia(take, {
        recordPointBeat: timing.recordPointBeat,
        mediaOriginSeconds: 0,
        clipMediaOriginSeconds: 0,
        timeline: liveTempoTimeline,
    });
    if (placed.passDepthSeconds !== undefined) {
        timing.starts.set(take.id, { songSeconds: placed.passDepthSeconds });
    }
}

function recordingPassDepthSeconds(take: Take, sourceContextOriginSeconds: number, mediaOriginSeconds: number): number {
    const start = recordingPassTimings.get(take.clipId)?.starts.get(take.id);
    if (!start) {
        throw new Error('Recording pass has no captured source timing');
    }
    if ('contextSeconds' in start) {
        return start.contextSeconds - sourceContextOriginSeconds;
    }
    return start.songSeconds - mediaOriginSeconds;
}

function retireRecordingPassTiming(clipId: string): void {
    recordingPassTimings.delete(clipId);
}

export const recordingPassTiming = {
    begin: beginRecordingPassTiming,
    stage: stageRecordingPassTiming,
    depthSeconds: recordingPassDepthSeconds,
    retire: retireRecordingPassTiming,
};
