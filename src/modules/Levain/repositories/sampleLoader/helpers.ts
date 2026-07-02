// ---------------------------------------------------------------------------
// LOD configuration
// ---------------------------------------------------------------------------

export type SampleLodConfig = {
    /** Maximum mic positions to load (0 = all). */
    maxMics: number;
    /** Maximum round-robin groups (0 = all). */
    maxRoundRobins: number;
};

export const WEB_LOD: SampleLodConfig = {
    maxMics: 2,
    maxRoundRobins: 3,
};
