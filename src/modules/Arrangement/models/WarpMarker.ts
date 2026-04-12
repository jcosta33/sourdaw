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

export const createWarpMarker = (originalBeat: number, warpedBeat: number): WarpMarker => ({
    id: `warp-${crypto.randomUUID().slice(0, 8)}`,
    originalBeat,
    warpedBeat,
});

export const defaultWarpState: WarpState = {
    enabled: false,
    markers: [],
    stretchMode: 'complex',
    originalTempo: null,
};
