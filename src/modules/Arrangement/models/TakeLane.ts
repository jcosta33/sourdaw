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
    takes: Take[];
    activeCompRegions: CompRegion[];
};

export type CompRegion = {
    startBeat: number;
    endBeat: number;
    takeId: string;
};

let nextTakeId = 1;
let nextLaneId = 1;

export const createTake = (clipId: string, name: string, startBeat: number, endBeat: number): Take => ({
    id: `take-${nextTakeId++}`,
    clipId,
    name,
    startBeat,
    endBeat,
    selected: false,
});

export const createTakeLane = (trackId: string): TakeLane => ({
    id: `take-lane-${nextLaneId++}`,
    trackId,
    takes: [],
    activeCompRegions: [],
});
