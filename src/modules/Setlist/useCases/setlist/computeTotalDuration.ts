import { type SetlistItem } from '../../stores/setlistStore';

/**
 * `totalDuration` is derived state, not an independently maintained counter:
 * every mutation that can change the item set or any `estimatedDuration`
 * recomputes it here from `items`.
 *
 * Incremental arithmetic per call site is how it went stale — editing a song's
 * length has no term to add or subtract, so the set total kept reporting the
 * length the set had before the edit. Gaps are excluded on purpose: the field
 * is the sum of the songs, and the remaining-time readout adds `gapSeconds`
 * itself.
 */
export function computeTotalDuration(items: SetlistItem[]): number {
    return items.reduce((sum, item) => sum + item.estimatedDuration, 0);
}
