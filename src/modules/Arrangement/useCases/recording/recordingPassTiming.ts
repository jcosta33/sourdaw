import { playheadClockRef, readSecondsAtBeat, transportStore } from '#/modules/Transport/stores';

import { placeTakeOnClipMedia, type Take } from '../../models/TakeLane';
import { liveTempoTimeline } from '../liveTempoTimeline';

type RecordingEnd = { contextSeconds: number; beatAtContextSeconds: (seconds: number) => number };

type PassStart = { contextSeconds: number } | { songSeconds: number };
type RecordingPassTiming = {
    recordPointBeat: number;
    firstPassClock: (() => number | null) | undefined;
    openPassContextSeconds: number | null;
    openPassBeat: number;
    previousSeamContextSeconds: number | null;
    pendingSeam: { takeId: string; contextSeconds: number; nextStartBeat: number; cancelled: boolean } | null;
    ending: { takeId: string; receipt: RecordingEnd; endBeat: number } | null;
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
        if (!timing.starts.has(take.id)) {
            timing.starts.set(take.id, { contextSeconds: firstStart });
        }
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
        timing.starts.set(take.id, { songSeconds: placed.passDepthSeconds });
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

/** A scheduled seam remains provisional until its physical clock has sounded. */
function finishRecordingPass(clipId: string, receipt: RecordingEnd, intendedEndBeat: number) {
    const timing = recordingPassTimings.get(clipId);
    const pending = timing?.pendingSeam;
    if (!timing || !pending) {
        return undefined;
    }
    if (!pending.cancelled && receipt.contextSeconds >= pending.contextSeconds) {
        beginNextPass(timing, pending.contextSeconds, pending.nextStartBeat);
        timing.pendingSeam = null;
        return undefined;
    }
    const endBeat = Math.min(intendedEndBeat, receipt.beatAtContextSeconds(receipt.contextSeconds));
    timing.ending = { takeId: pending.takeId, receipt, endBeat };
    timing.pendingSeam = null;
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

function retireRecordingPassTiming(clipId: string): void {
    recordingPassTimings.delete(clipId);
}

export const recordingPassTiming = {
    begin: beginRecordingPassTiming,
    stage: stageRecordingPassTiming,
    depthSeconds: recordingPassDepthSeconds,
    retire: retireRecordingPassTiming,
    finish: finishRecordingPass,
    captureEnd: recordingPassCaptureEnd,
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
