export type WarpMarker = {
    id: string;
    originalBeat: number;
    warpedBeat: number;
};

export type WarpState = {
    enabled: boolean;
    markers: WarpMarker[];
    stretchMode: 'repitch' | 'complex' | 'texture' | 'beats';
    originalTempo: number | null;
};

let nextWarpMarkerId = 1;

export const createWarpMarker = (originalBeat: number, warpedBeat: number): WarpMarker => ({
    id: `warp-${nextWarpMarkerId++}`,
    originalBeat,
    warpedBeat,
});

export const defaultWarpState: WarpState = {
    enabled: false,
    markers: [],
    stretchMode: 'complex',
    originalTempo: null,
};

export function getWarpedPosition(markers: WarpMarker[], originalBeat: number): number {
    if (markers.length === 0) {
        return originalBeat;
    }

    const sorted = [...markers].sort((a, b) => a.originalBeat - b.originalBeat);
    const before = sorted.filter((m) => m.originalBeat <= originalBeat);
    const after = sorted.filter((m) => m.originalBeat > originalBeat);

    if (before.length === 0) {
        return originalBeat;
    }
    if (after.length === 0) {
        return before[before.length - 1]!.warpedBeat + (originalBeat - before[before.length - 1]!.originalBeat);
    }

    const prev = before[before.length - 1]!;
    const next = after[0]!;

    const t = (originalBeat - prev.originalBeat) / (next.originalBeat - prev.originalBeat);
    return prev.warpedBeat + (next.warpedBeat - prev.warpedBeat) * t;
}
