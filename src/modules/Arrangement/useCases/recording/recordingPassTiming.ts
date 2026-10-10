import { playheadClockRef, readSecondsAtBeat, transportStore } from '#/modules/Transport/stores';

import { placeTakeOnClipMedia, type Take } from '../../models/TakeLane';
import { liveTempoTimeline } from '../liveTempoTimeline';

type RecordingEnd = { contextSeconds: number; beatAtContextSeconds: (seconds: number) => number };

type PassStart =
    { contextSeconds: number; endContextSeconds: number } | { songSeconds: number; endSongSeconds: number };
type RecordingPassTiming = {
    recordPointBeat: number;
    firstPassClock: (() => number | null) | undefined;
    openPassContextSeconds: number | null;
    openPassBeat: number;
    previousSeamContextSeconds: number | null;
    pendingSeam: { takeId: string; contextSeconds: number; nextStartBeat: number; cancelled: boolean } | null;
    ending: { takeId: string | undefined; receipt: RecordingEnd; endBeat: number; endContextSeconds: number } | null;
    nextPassStartBeat: number | null;
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
    const openPassBeat = Math.max(recordPointBeat, transport.loopStart);
    let recordPointContextSeconds: number | null = null;
    if (transport.isPlaying) {
        recordPointContextSeconds =
            playheadClockRef.audioTimeSeconds + recordPointSeconds - seconds(playheadClockRef.beat);
    }
    recordingPassTimings.set(clipId, {
        recordPointBeat,
        firstPassClock,
        openPassContextSeconds: openPassBeat === recordPointBeat ? recordPointContextSeconds : null,
        openPassBeat,
        previousSeamContextSeconds: null,
        pendingSeam: null,
        ending: null,
        nextPassStartBeat: null,
        starts: new Map(),
    });
}

function stageRecordingPassTiming(take: Take, passEndContextSeconds?: number, planned = false): void {
    const timing = recordingPassTimings.get(take.clipId);
    if (!timing || take.sourceOffsetBeats === undefined) {
        return;
    }
    if (passEndContextSeconds !== undefined) {
        const firstStart =
            timing.openPassContextSeconds ??
            (timing.openPassBeat === timing.recordPointBeat ? (timing.firstPassClock?.() ?? null) : null);
        if (firstStart === null) {
            throw new Error('Recording pass has no rolling capture clock');
        }
        // A cancelled planned ending reuses the captured entry of that take.
        const priorStart = timing.starts.get(take.id);
        timing.starts.set(take.id, {
            contextSeconds: priorStart && 'contextSeconds' in priorStart ? priorStart.contextSeconds : firstStart,
            endContextSeconds: passEndContextSeconds,
        });
        timing.nextPassStartBeat = null;
        if (planned) {
            timing.pendingSeam = {
                takeId: take.id,
                contextSeconds: passEndContextSeconds,
                nextStartBeat: transportStore.value?.loopStart ?? take.startBeat,
                cancelled: false,
            };
        } else {
            timing.pendingSeam = null;
            beginNextPass(timing, passEndContextSeconds, transportStore.value?.loopStart ?? take.startBeat);
        }
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
        timing.starts.set(take.id, {
            songSeconds: placed.passDepthSeconds,
            endSongSeconds:
                placed.passDepthSeconds +
                liveTempoTimeline.secondsAtBeat(placed.endBeat) -
                liveTempoTimeline.secondsAtBeat(placed.startBeat),
        });
    }
}

function beginNextPass(timing: RecordingPassTiming, contextSeconds: number, beat: number): void {
    timing.previousSeamContextSeconds = contextSeconds;
    timing.openPassContextSeconds = contextSeconds;
    timing.openPassBeat = beat;
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

function recordingPassSourceEndSeconds(
    take: Take,
    sourceContextOriginSeconds: number,
    mediaOriginSeconds: number
): number {
    const timing = recordingPassTimings.get(take.clipId);
    const start = timing?.starts.get(take.id);
    if (!start) {
        throw new Error('Recording pass has no captured source ending');
    }
    if ('contextSeconds' in start) {
        return (
            Math.min(start.endContextSeconds, timing?.ending?.endContextSeconds ?? Infinity) -
            sourceContextOriginSeconds
        );
    }
    return start.endSongSeconds - mediaOriginSeconds;
}

function observeRecordingPassEntry(
    clipIds: readonly string[],
    beat: number,
    contextSeconds: number,
    relocated: boolean
): void {
    const transport = transportStore.value;
    if (!transport) {
        return;
    }
    for (const clipId of clipIds) {
        const timing = recordingPassTimings.get(clipId);
        if (!timing) {
            continue;
        }
        if (
            timing.pendingSeam &&
            !timing.pendingSeam.cancelled &&
            contextSeconds >= timing.pendingSeam.contextSeconds
        ) {
            beginNextPass(timing, timing.pendingSeam.contextSeconds, timing.pendingSeam.nextStartBeat);
            timing.pendingSeam = null;
        }
        // A staged pass owns its start even if its planned seam is cancelled:
        // stageRecordingTake reuses that take's geometry when replacing it.
        if (timing.pendingSeam) {
            continue;
        }
        let openPassBeat = timing.nextPassStartBeat ?? transport.loopStart;
        if (timing.nextPassStartBeat === null && timing.previousSeamContextSeconds === null) {
            openPassBeat = Math.max(timing.recordPointBeat, transport.loopStart);
        }
        const entryMoved = openPassBeat !== timing.openPassBeat;
        if (entryMoved) {
            // Only the still-open pass follows an edited entry. Completed
            // takes keep their own clocks in starts.
            timing.openPassBeat = openPassBeat;
            timing.openPassContextSeconds = null;
        }
        if (timing.openPassContextSeconds !== null || beat < openPassBeat) {
            continue;
        }
        if (relocated || entryMoved) {
            timing.openPassContextSeconds = contextSeconds;
        } else {
            timing.openPassContextSeconds =
                contextSeconds + readSecondsAtBeat({ beat: openPassBeat }) - readSecondsAtBeat({ beat });
        }
    }
}

function cancelRecordingPassBoundary(clipId: string, contextSeconds: number): void {
    const timing = recordingPassTimings.get(clipId);
    if (!timing?.pendingSeam) {
        return;
    }
    if (contextSeconds >= timing.pendingSeam.contextSeconds) {
        beginNextPass(timing, timing.pendingSeam.contextSeconds, timing.pendingSeam.nextStartBeat);
        timing.pendingSeam = null;
        return;
    }
    timing.pendingSeam.cancelled = true;
}

function relocateRecordingPassEntry(clipId: string, beat: number): void {
    const timing = recordingPassTimings.get(clipId);
    if (timing) {
        timing.nextPassStartBeat = beat;
        timing.openPassBeat = beat;
    }
}

/** Freeze every audio ending; only an unsounded planned pass needs its take shortened here. */
function finishRecordingPass(clipId: string, receipt: RecordingEnd, intendedEndBeat: number) {
    const timing = recordingPassTimings.get(clipId);
    if (!timing) {
        return undefined;
    }
    // A capture still waiting for its first roll has no moving song clock.
    // Its stopped PCM is retained on the hold's signed placement instead.
    const firstPassContextSeconds = timing.openPassContextSeconds ?? timing.firstPassClock?.() ?? null;
    if (firstPassContextSeconds === null) {
        return undefined;
    }
    const pending = timing.pendingSeam;
    const stoppedBeat = receipt.beatAtContextSeconds(receipt.contextSeconds);
    const endBeat = Math.min(intendedEndBeat, stoppedBeat);
    const endContextSeconds =
        receipt.contextSeconds - readSecondsAtBeat({ beat: stoppedBeat }) + readSecondsAtBeat({ beat: endBeat });
    const unsounded = pending && (pending.cancelled || receipt.contextSeconds < pending.contextSeconds);
    timing.ending = { takeId: unsounded ? pending.takeId : undefined, receipt, endBeat, endContextSeconds };
    if (!pending) {
        return undefined;
    }
    timing.pendingSeam = null;
    if (!unsounded) {
        beginNextPass(timing, pending.contextSeconds, pending.nextStartBeat);
        return undefined;
    }
    return { takeId: pending.takeId, endBeat };
}

/** Excess producer drain can never extend the frozen intended ending. */
function recordingPassCaptureEnd(clipId: string, availableEndContextSeconds: number) {
    const ending = recordingPassTimings.get(clipId)?.ending;
    if (!ending) {
        return undefined;
    }
    return {
        takeId: ending.takeId,
        endBeat: Math.min(ending.endBeat, ending.receipt.beatAtContextSeconds(availableEndContextSeconds)),
    };
}

/** Close the provisional final lap only after its preceding seam sounded. */
function finalRecordingPass(clipId: string, availableEndContextSeconds: number) {
    const timing = recordingPassTimings.get(clipId);
    if (
        !timing?.ending ||
        timing.ending.takeId !== undefined ||
        timing.previousSeamContextSeconds === null ||
        timing.openPassContextSeconds === null
    ) {
        return undefined;
    }
    const passEndContextSeconds = Math.min(availableEndContextSeconds, timing.ending.receipt.contextSeconds);
    const endBeat = Math.min(timing.ending.endBeat, timing.ending.receipt.beatAtContextSeconds(passEndContextSeconds));
    if (passEndContextSeconds <= timing.openPassContextSeconds || endBeat <= timing.openPassBeat) {
        // No incoming PCM: close its existing identity at the entry. Normal
        // take placement retires this empty geometry before the one commit.
        return {
            startBeat: timing.openPassBeat,
            endBeat: timing.openPassBeat,
            passEndContextSeconds: timing.openPassContextSeconds,
        };
    }
    return { startBeat: timing.openPassBeat, endBeat, passEndContextSeconds };
}

function retireRecordingPassTiming(clipId: string): void {
    recordingPassTimings.delete(clipId);
}

export const recordingPassTiming = {
    begin: beginRecordingPassTiming,
    stage: stageRecordingPassTiming,
    depthSeconds: recordingPassDepthSeconds,
    sourceEndSeconds: recordingPassSourceEndSeconds,
    retire: retireRecordingPassTiming,
    finish: finishRecordingPass,
    captureEnd: recordingPassCaptureEnd,
    finalPass: finalRecordingPass,
    observeEntry: observeRecordingPassEntry,
    cancelBoundary: cancelRecordingPassBoundary,
    replacementTakeId: (clipId: string): string | undefined => {
        const pending = recordingPassTimings.get(clipId)?.pendingSeam;
        return pending?.cancelled ? pending.takeId : undefined;
    },
    nextStartBeat: (clipId: string): number | undefined =>
        recordingPassTimings.get(clipId)?.nextPassStartBeat ?? undefined,
    relocateEntry: relocateRecordingPassEntry,
};
