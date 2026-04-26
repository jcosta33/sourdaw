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

export function createMarker(beat: number, name: string): Marker {
    return {
        id: `marker-${crypto.randomUUID().slice(0, 8)}`,
        beat,
        name,
        color: 'oklch(0.40 0.07 200)',
    };
}

export function createSection(startBeat: number, endBeat: number, name: string): ArrangementSection {
    return {
        id: `section-${crypto.randomUUID().slice(0, 8)}`,
        startBeat,
        endBeat,
        name,
        color: 'oklch(0.35 0.06 260)',
    };
}
