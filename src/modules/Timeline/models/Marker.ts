export type Marker = {
    id: string;
    beat: number;
    name: string;
    color: string;
};

export type ArrangementSection = {
    id: string;
    startBeat: number;
    endBeat: number;
    name: string;
    color: string;
};

let nextMarkerId = 1;
let nextSectionId = 1;

export const createMarker = (beat: number, name: string): Marker => ({
    id: `marker-${nextMarkerId++}`,
    beat,
    name,
    color: 'oklch(0.40 0.07 200)',
});

export const createSection = (startBeat: number, endBeat: number, name: string): ArrangementSection => ({
    id: `section-${nextSectionId++}`,
    startBeat,
    endBeat,
    name,
    color: 'oklch(0.35 0.06 260)',
});
