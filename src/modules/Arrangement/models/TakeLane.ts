export type Take = {
    id: string;
    clipId: string;
    name: string;
    startBeat: number;
    endBeat: number;
    selected: boolean;
    /**
     * Where this take's material begins inside its source clip's recorded
     * media, in beats from the media's first sample. Loop recording writes every
     * pass into one continuous clip, so each wrap take names its own pass's
     * offset and comp resolution reads that pass's material instead of the first
     * pass again. Absent means the clip's own origin — flat recordings, manual
     * takes, and takes predating the field.
     */
    sourceOffsetBeats?: number;
    /**
     * Where a pass begins sounding, in beats from its clip's media origin (the
     * beat the clip's first recorded sample sounds on): the material at
     * `sourceOffsetBeats` plays there. It is measured against the clip's media,
     * never the timeline, so moving, nudging, slipping or trimming the clip
     * carries the pass with it. Negative when the pass sounds before the media
     * begins, which a recording started inside the loop gives every pass after
     * the first; its clip then opens at the loop start with a negative media
     * offset, so the pass still sounds inside it. Only meaningful beside
     * `sourceOffsetBeats`; absent means a pass
     * recorded before the field existed, which sounds from the media origin and
     * is bounded by its clip alone.
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
 * The recorder mints offsets against the provisional anchor, the beat the clip
 * opened on. The capture's first sample sits `shiftBeats` before that anchor
 * (hardware latency and the wait for the transport to roll), and the committed
 * clip places the media there, so a pass resolved from its take must too. The
 * take opened when recording began carries no offset and sits at the anchor, so
 * it takes the shift as its whole offset. A zero offset on a take that starts
 * before the anchor is the first pass of a recording that began inside the
 * loop: the scheduler clamps its depth, and an offset cannot be negative, so the
 * take starts where its media does, at the anchor.
 */
function measureTakeFromMedia(take: Take, provisionalStartBeat: number, shiftBeats: number): Take {
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
 * Record where a pass sounds against its clip's media origin while the take's
 * timeline start still describes the clip as recorded. Nothing later keeps the
 * take's timeline position in step with its clip, so this is the only moment it
 * can be read as a placement.
 */
function placeTakeOnMedia(take: Take, mediaOriginBeat: number): Take {
    if (take.sourceOffsetBeats === undefined) {
        return take;
    }
    const passStartBeats = take.startBeat - mediaOriginBeat;
    if (take.passStartBeats === passStartBeats) {
        return take;
    }
    return { ...take, passStartBeats };
}

/**
 * Re-measure a recording take against the media's first sample, which sits
 * `shiftBeats` before the provisional anchor: its `sourceOffsetBeats` from that
 * sample, and its `passStartBeats` from the beat the committed clip places it on.
 *
 * Idempotent once applied, which matters for a MIDI recording: its clip never
 * moves, so a zero shift only restores the clamped start and places each pass.
 */
export function rebaseTakeOntoMedia(take: Take, provisionalStartBeat: number, shiftBeats: number): Take {
    const measured = measureTakeFromMedia(take, provisionalStartBeat, shiftBeats);
    return placeTakeOnMedia(measured, provisionalStartBeat - shiftBeats);
}

export function createTakeLane(trackId: string): TakeLane {
    return {
        id: `take-lane-${crypto.randomUUID()}`,
        trackId,
        takes: [],
        activeCompRegions: [],
    };
}
