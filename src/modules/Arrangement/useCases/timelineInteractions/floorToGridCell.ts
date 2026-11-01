/** Absorbs the division error of a pointer sitting exactly on a grid line (0.3 / 0.1 = 2.9999999999999996). */
const CELL_EPSILON = 1e-9;

/**
 * Start of the grid cell that contains `beat`. A beat on a grid line belongs to
 * the cell starting there. A snap of 0 means the grid is off and keeps the beat.
 */
export function floorToGridCell(beat: number, snap: number): number {
    if (snap <= 0) {
        return beat;
    }
    return Math.floor(beat / snap + CELL_EPSILON) * snap;
}
