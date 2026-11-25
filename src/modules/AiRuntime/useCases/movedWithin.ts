/**
 * Whether `to` moved from `from` by at most `tolerance`. Subtracting two binary figures can exceed the
 * exact decimal difference by a few units in the last place (0.51 − 0.5 is 0.010000000000000009), so a
 * movement over the tolerance by no more than that rounding is a movement of exactly the tolerance.
 */
export function movedWithin(from: number, to: number, tolerance: number): boolean {
    const allowance = 4 * Number.EPSILON * Math.max(Math.abs(from), Math.abs(to), tolerance);
    return to - from <= tolerance + allowance;
}
