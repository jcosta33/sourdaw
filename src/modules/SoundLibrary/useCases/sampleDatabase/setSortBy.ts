import { type SampleDatabaseState } from '../../models/SampleEntry';
import { sampleDatabaseStore } from '../../stores/sampleDatabaseStore';

/**
 * Set the active sort field, and resolve the sort direction.
 *
 * Direction resolution:
 * - If `direction` is given, it is used verbatim.
 * - Otherwise, when `sortBy` equals the current sort field AND the current
 *   direction is `'asc'`, the direction toggles to `'desc'` (re-selecting the
 *   active column flips ascending → descending).
 * - In every other no-`direction` case (a different field, or current
 *   direction already `'desc'`), the direction resets to `'asc'`.
 */
export function setSortBy(sortBy: SampleDatabaseState['sortBy'], direction?: 'asc' | 'desc'): void {
    const state = sampleDatabaseStore.value;
    if (!state) {
        return;
    }
    sampleDatabaseStore.set({
        ...state,
        sortBy,
        sortDirection: direction ?? (state.sortBy === sortBy && state.sortDirection === 'asc' ? 'desc' : 'asc'),
    });
}
