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
    return {
        id: `take-${crypto.randomUUID()}`,
        clipId,
        name,
        startBeat,
        endBeat,
        selected: false,
        // Kept off the object when absent so the sanitized store shape stays
        // exactly what older projects persisted.
        ...(sourceOffsetBeats === undefined ? {} : { sourceOffsetBeats }),
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
