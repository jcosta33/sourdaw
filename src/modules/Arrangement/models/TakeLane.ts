export type Take = {
    id: string;
    clipId: string;
    name: string;
    startBeat: number;
    endBeat: number;
    selected: boolean;
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

export function createTake(clipId: string, name: string, startBeat: number, endBeat: number): Take {
    return {
        id: `take-${crypto.randomUUID()}`,
        clipId,
        name,
        startBeat,
        endBeat,
        selected: false,
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
