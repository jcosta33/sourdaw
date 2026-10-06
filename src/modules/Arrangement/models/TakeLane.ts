export type Take = {
    id: string;
    clipId: string;
    name: string;
    startBeat: number;
    endBeat: number;
    selected: boolean;
    /**
     * Where this take's material begins inside its source clip's recorded
     * media, in beats from the clip's start. Loop recording writes every pass
     * into one continuous clip, so each wrap take names its own pass's offset
     * and comp resolution reads that pass's material instead of the first
     * pass again. Absent means the clip's own origin — flat recordings,
     * manual takes, and takes predating the field.
     */
    sourceOffsetBeats?: number;
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
 * Re-measure a recording take's `sourceOffsetBeats` from the media's first
 * sample.
 *
 * The recorder mints offsets against the provisional anchor, the beat the clip
 * opened on. The capture's first sample sits `shiftBeats` before that anchor
 * (hardware latency and the wait for the transport to roll), and the committed
 * clip places the media there, so a pass resolved from its take must too. The
 * take opened when recording began carries no offset and sits at the anchor, so
 * it takes the shift as its whole offset. A zero offset on a take that starts
 * before the anchor is the first pass of a recording that began inside the
 * loop: the scheduler clamps its depth, and an offset cannot be negative, so the
 * take starts where its media does, at the anchor.
 *
 * Idempotent for a zero shift, which is the whole story of a MIDI recording: its
 * clip never moves, so only that clamped start is restored.
 */
export function rebaseTakeOntoMedia(take: Take, provisionalStartBeat: number, shiftBeats: number): Take {
    const mintedOffsetBeats = take.sourceOffsetBeats ?? 0;
    if (mintedOffsetBeats !== 0) {
        if (shiftBeats === 0) {
            return take;
        }
        return { ...take, sourceOffsetBeats: mintedOffsetBeats + shiftBeats };
    }
    const mediaStartsInsideTake = take.startBeat < provisionalStartBeat && provisionalStartBeat < take.endBeat;
    const startBeat = mediaStartsInsideTake ? provisionalStartBeat : take.startBeat;
    if (startBeat === take.startBeat && shiftBeats === 0) {
        return take;
    }
    return { ...take, startBeat, sourceOffsetBeats: shiftBeats };
}

/**
 * Hide a loop pass's material before `startBeat`, as trimming the start of the
 * clip that holds it does. The pass begins at `startBeat` instead, and its
 * offset deepens by the same distance, so the media it plays at every later
 * beat is unchanged. A take without an offset plays the clip's own media, which
 * the clip's start already bounds, so it is returned as it is.
 */
export function trimTakeStart(take: Take, startBeat: number): Take {
    if (take.sourceOffsetBeats === undefined || take.startBeat >= startBeat) {
        return take;
    }
    const trimmedStartBeat = Math.min(startBeat, take.endBeat);
    return {
        ...take,
        startBeat: trimmedStartBeat,
        sourceOffsetBeats: take.sourceOffsetBeats + (trimmedStartBeat - take.startBeat),
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
