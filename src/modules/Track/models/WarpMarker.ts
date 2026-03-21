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


