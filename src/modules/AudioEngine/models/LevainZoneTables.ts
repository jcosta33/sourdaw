/**
 * One zone's place in a Levain bank's lookup tables: the zone id the loader
 * gives its `addZone` message, and the (articulation, mic, key, velocity)
 * region it covers.
 */
export type LevainZoneSpan = {
    zoneId: number;
    articulationId: number;
    micId: number;
    loKey: number;
    hiKey: number;
    loVel: number;
    hiVel: number;
};

export type LevainZoneTableRequest = {
    zones: readonly LevainZoneSpan[];
    numArticulations: number;
    numMics: number;
};

/**
 * A bank's computed zone tables, in the layout they travel to the worklet in:
 * the LUT as interleaved (offset, count) words, one pair per
 * (articulation, mic, note, velocity bucket) slot, and the arena of zone ids
 * those pairs index.
 */
export type LevainZoneTables = {
    lut: Uint32Array;
    arena: Uint32Array;
};
