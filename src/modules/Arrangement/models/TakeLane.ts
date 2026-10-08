import { type TempoTimeline } from './TempoTimeline';

export type Take = {
    id: string;
    clipId: string;
    name: string;
    startBeat: number;
    endBeat: number;
    selected: boolean;
    /**
     * Where this take's material begins inside its source clip's recorded
     * media, in beats from the clip's media origin. Loop recording writes every
     * pass into one continuous clip, so each wrap take names its own pass's
     * offset and comp resolution reads that pass's material instead of the first
     * pass again. Absent means the clip's own origin — flat recordings, manual
     * takes, and takes predating the field.
     *
     * An audio pass placed at commit keeps the depth the recorder minted, in
     * unwrapped beats from the record point, and sounds by its two seconds
     * fields instead.
     */
    sourceOffsetBeats?: number;
    /**
     * Where a placed audio pass starts sounding, as a second of its clip's own
     * media: the beat it starts on is the beat the clip's media reaches this
     * second. Measured against the clip's media, never the timeline, so a move,
     * a nudge or a slip of the clip carries the pass exactly as it carries the
     * clip's own content, across any tempo change. Negative when the pass
     * sounds before the media begins, which a recording begun inside the loop
     * gives every pass after the first; its clip then opens at the loop start
     * with a negative media offset, so the pass still sounds inside it.
     */
    passAnchorSeconds?: number;
    /**
     * The second of the recording at which a placed audio pass's material
     * begins: what sounds at `passAnchorSeconds`.
     *
     * The two seconds fields come together, only on audio loop passes placed
     * at commit and only beside `sourceOffsetBeats`. Absent means a MIDI pass
     * or a pass recorded before placement existed, which keeps main's law: its
     * material sounds from its clip's start, bounded by its clip alone.
     */
    passDepthSeconds?: number;
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

type PassPlacementInput = {
    /** The beat the recorder opened the clip on, which every staged take was minted against. */
    recordPointBeat: number;
    /** The song time the capture's first sample sounds on. */
    mediaOriginSeconds: number;
    /**
     * The song time the committed clip's media begins on, read the way the
     * readers read the clip: its start, less its offset at its start's tempo.
     */
    clipMediaOriginSeconds: number;
    timeline: TempoTimeline;
};

/**
 * Song seconds the capture ran from the record point to where a staged pass
 * begins. The scheduler mints a pass's depth in unwrapped beats from the record
 * point: through the run-up (or, begun inside the loop, the short first pass)
 * to the loop boundary, then a whole loop per later pass. The pass's take spans
 * that loop, so the same walk measures it on the tempo map.
 */
function secondsIntoRecording(take: Take, recordPointBeat: number, timeline: TempoTimeline): number {
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
 * Place an audio loop pass against its committed clip's media, in seconds.
 *
 * The pass is given the second of the clip's own media at which it starts
 * sounding, `passAnchorSeconds`, and the second of the recording at which its
 * material begins, `passDepthSeconds`: the time the capture had run when that
 * lap began. Both are media time, so whatever later moves or slips the clip's
 * content, or whatever tempo the beats between sound at, the pass stays on the
 * material the clip holds there.
 *
 * A take that names no media depth is not a pass: it plays the clip's own
 * media as the clip places it and is returned as it is.
 */
export function placeTakeOnClipMedia(take: Take, input: PassPlacementInput): Take {
    const { recordPointBeat, mediaOriginSeconds, clipMediaOriginSeconds, timeline } = input;
    if (take.sourceOffsetBeats === undefined) {
        return take;
    }
    const placed = startFirstPassAtRecordPoint(take, recordPointBeat);
    return {
        ...placed,
        passAnchorSeconds: timeline.secondsAtBeat(placed.startBeat) - clipMediaOriginSeconds,
        passDepthSeconds:
            secondsIntoRecording(take, recordPointBeat, timeline) +
            timeline.secondsAtBeat(recordPointBeat) -
            mediaOriginSeconds,
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
