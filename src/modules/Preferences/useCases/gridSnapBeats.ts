import { GRID_SNAP_OPTIONS, type GridSnapOption } from '../models/Preferences';

/**
 * Beat span of a grid subdivision. The table lives in the model — this file used
 * to carry a byte-for-byte copy of it, and the two were free to drift apart
 * (they had, on the triplet rows) with nothing to notice.
 */
export function gridSnapBeats(option: GridSnapOption): number {
    const entry = GRID_SNAP_OPTIONS.find((gridOption) => gridOption.value === option);
    return entry?.beats ?? 0;
}
