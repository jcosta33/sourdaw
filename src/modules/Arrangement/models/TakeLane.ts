export type Take = {
    id: string;
    clipId: string;
    name: string;
    startBeat: number;
    endBeat: number;
    selected: boolean;
    /**
     * Where this take's material begins inside its source clip's recorded
     * media, from the media's first sample. Loop recording writes every pass
     * into one continuous clip, so each wrap take names its own pass's offset
     * and comp resolution reads that pass's material instead of the first pass
     * again. Absent means the clip's own origin — flat recordings, manual takes,
     * and takes predating the field.
     *
     * An audio pass placed at commit (one carrying `passStartBeats`) holds it in
     * the unit the readers seek in, like a clip's `audioOffsetBeats`: the media
     * seconds before its material, converted at the tempo governing the beat
     * the pass begins sounding on, so a fragment entering there seeks to exactly
     * that material whatever the tempo map does. Any other pass holds beats
     * from the media's first sample.
     */
    sourceOffsetBeats?: number;
    /**
     * Where a pass begins sounding, from its clip's media origin
     * (`clipMediaOriginBeat`: the clip start less its media offset): the
     * material at `sourceOffsetBeats` plays there. It is measured at commit
     * against the committed clip's own media origin, in the same unit, so the
     * pass starts exactly where it was recorded, and it is relative to the
     * clip's media, never the timeline, so moving, nudging, slipping or
     * trimming the clip carries the pass with it. Negative when the pass sounds
     * before the media begins, which a recording started inside the loop gives
     * every pass after the first; its clip then opens at the loop start with a
     * negative media offset, so the pass still sounds inside it.
     *
     * Only audio loop recordings carry it, and only beside `sourceOffsetBeats`.
     * Absent means a MIDI pass or a pass recorded before the field existed,
     * which sounds from its clip's start, bounded by its clip alone.
     */
    passStartBeats?: number;
};

export type TakeLane = {
    id: string;
    trackId: string;
    automationLaneId?: string; // F3.1: If set, this lane is for automation comping
    takes: Take[];
    activeCompRegions: CompRegion[];
};

export type CompRegion = {
    startBeat: number;
    endBeat: number;
    takeId: string;
};

export function createTake(
    clipId: string,
    name: string,
    startBeat: number,
    endBeat: number,
    sourceOffsetBeats?: number
): Take {
    const take: Take = {
        id: `take-${crypto.randomUUID()}`,
        clipId,
        name,
        startBeat,
        endBeat,
        selected: false,
    };
    // Kept off the object when absent so the sanitized store shape stays
    // exactly what older projects persisted.
    if (sourceOffsetBeats !== undefined) {
        take.sourceOffsetBeats = sourceOffsetBeats;
    }
    return take;
}

/**
 * The first pass of a loop recording begun inside the loop is staged across
 * the whole loop, but nothing was captured before the record point, so the
 * take starts there. The scheduler mints that pass, alone among wrap takes,
 * with a zero media depth; every other take is returned as it is.
 */
export function startFirstPassAtRecordPoint(take: Take, recordPointBeat: number): Take {
    const recordPointInsideTake = take.startBeat < recordPointBeat && recordPointBeat < take.endBeat;
    if (take.sourceOffsetBeats !== 0 || !recordPointInsideTake) {
        return take;
    }
    return { ...take, startBeat: recordPointBeat };
}

/** The tempo map as a pass placement reads it. */
export type RecordingTimeline = {
    secondsAtBeat: (beat: number) => number;
    tempoAtBeat: (beat: number) => number;
};

type PassPlacementInput = {
    /** The beat the recorder opened the clip on, which every staged take was minted against. */
    recordPointBeat: number;
    /** The song time the capture's first sample sounds on. */
    mediaOriginSeconds: number;
    /** The committed clip's media origin: its start less its media offset. */
    clipMediaOriginBeat: number;
    timeline: RecordingTimeline;
};

/**
 * Song seconds the capture ran from the record point to where a staged pass
 * begins. The scheduler mints a pass's depth in unwrapped beats from the record
 * point: through the run-up (or, begun inside the loop, the short first pass)
 * to the loop boundary, then a whole loop per later pass. The pass's take spans
 * that loop, so the same walk measures it on the tempo map.
 */
function secondsIntoRecording(take: Take, recordPointBeat: number, timeline: RecordingTimeline): number {
    const seconds = (fromBeat: number, toBeat: number): number =>
        timeline.secondsAtBeat(toBeat) - timeline.secondsAtBeat(fromBeat);
    const depthBeats = take.sourceOffsetBeats ?? 0;
    const firstBoundaryBeat = recordPointBeat < take.startBeat ? take.startBeat : take.endBeat;
    const firstSegmentBeats = firstBoundaryBeat - recordPointBeat;
    if (depthBeats <= firstSegmentBeats) {
        return seconds(recordPointBeat, recordPointBeat + depthBeats);
    }
    const loopBeats = take.endBeat - take.startBeat;
    const wholeLoops = Math.floor((depthBeats - firstSegmentBeats) / loopBeats);
    const partialBeats = depthBeats - firstSegmentBeats - wholeLoops * loopBeats;
    return (
        seconds(recordPointBeat, firstBoundaryBeat) +
        wholeLoops * seconds(take.startBeat, take.endBeat) +
        seconds(take.startBeat, take.startBeat + partialBeats)
    );
}

/**
 * Place an audio recording take against its committed clip's media.
 *
 * The take is given the beat it starts sounding on, `passStartBeats` from the
 * clip's media origin, and the media its material begins at, `sourceOffsetBeats`.
 * Both are written in the clip's own offset unit, the one the readers seek in:
 * the placement is measured against `clipMediaOriginBeat` of the clip as it
 * commits, and the media depth is the seconds the capture had run when the
 * pass began, converted at the tempo governing the beat it sounds on. A comp
 * fragment entering the pass at its start therefore seeks to exactly the
 * material recorded there, across any tempo change.
 *
 * A take with no media depth on a capture that began exactly at the record
 * point plays the clip's own media and is returned as it is.
 */
export function placeTakeOnClipMedia(take: Take, input: PassPlacementInput): Take {
    const { recordPointBeat, mediaOriginSeconds, clipMediaOriginBeat, timeline } = input;
    const placed = startFirstPassAtRecordPoint(take, recordPointBeat);
    const mediaSeconds =
        secondsIntoRecording(take, recordPointBeat, timeline) +
        timeline.secondsAtBeat(recordPointBeat) -
        mediaOriginSeconds;
    if (placed.sourceOffsetBeats === undefined && mediaSeconds === 0) {
        return placed;
    }
    return {
        ...placed,
        sourceOffsetBeats: (mediaSeconds * timeline.tempoAtBeat(placed.startBeat)) / 60,
        passStartBeats: placed.startBeat - clipMediaOriginBeat,
    };
}

export function createTakeLane(trackId: string): TakeLane {
    return {
        id: `take-lane-${crypto.randomUUID()}`,
        trackId,
        takes: [],
        activeCompRegions: [],
    };
}
