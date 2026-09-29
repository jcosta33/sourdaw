/**
 * The one lexicographic path comparison: the collector's evidence admission order and the plan's unit
 * admission key both order by path as their final tie-break, and two restatements of it would be two
 * orders. It lives in its own leaf so the key can read it without reaching the collector's module graph,
 * which the review entry point's trusted-executing closure pins.
 */

/** Compares two repository paths lexicographically, by code unit. */
export function compareLexicographic(left: string, right: string): number {
    if (left < right) {
        return -1;
    }
    if (left > right) {
        return 1;
    }
    return 0;
}
