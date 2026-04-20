export type GrooveTemplate = {
    id: string;
    name: string;
    /** Beat subdivisions and their timing offsets (fraction of grid step) */
    offsets: Array<{
        gridPosition: number; // 0-based beat subdivision index
        timingOffset: number; // deviation in beats (-0.1 to +0.1 typically)
        velocityScale: number; // 0.5 to 1.5 velocity multiplier
    }>;
    gridDivision: number; // e.g. 0.25 = 16th notes
    sourceClipId: string;
};
