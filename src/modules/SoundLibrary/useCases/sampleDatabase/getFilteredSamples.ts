import { sampleDatabaseStore } from '#/modules/SoundLibrary/stores/sampleDatabaseStore';
import { type SampleEntry } from '#/modules/SoundLibrary/models/SampleEntry';
import { AUTO_TAG_RULES } from '#/modules/SoundLibrary/services/sampleTaggingHelpers';

/**
 * §69.2 — Identity-keyed memo cache. The full filter+sort pipeline is
 * invariant when the underlying state object and all filter fields are
 * unchanged. React re-renders of the sample browser repeatedly call
 * getFilteredSamples from render, and it's also called during Jaccard
 * similarity precomputes — caching by (state identity, fingerprint)
 * short-circuits the hot path.
 */
type MemoEntry = {
    stateRef: NonNullable<typeof sampleDatabaseStore.value>;
    fingerprint: string;
    result: SampleEntry[];
};
let memo: MemoEntry | null = null;

/**
 * Get filtered, sorted samples based on current search/filter/sort state.
 */
export function getFilteredSamples(): SampleEntry[] {
    const state = sampleDatabaseStore.value;
    if (!state) {
        return [];
    }

    const fingerprint = [
        state.searchQuery,
        state.activeFilters.join('|'),
        state.categoryFilter ?? '',
        state.favoritesOnly ? '1' : '0',
        state.sortBy,
        state.sortDirection,
    ].join('\0');

    if (memo !== null && memo.stateRef === state && memo.fingerprint === fingerprint) {
        return memo.result;
    }

    let results = [...state.samples];

    // Text search
    if (state.searchQuery.trim()) {
        const q = state.searchQuery.toLowerCase();
        results = results.filter(
            (s) =>
                s.name.toLowerCase().includes(q) ||
                s.path.toLowerCase().includes(q) ||
                s.tags.some((t) => t.name.toLowerCase().includes(q))
        );
    }

    // Tag filters
    if (state.activeFilters.length > 0) {
        results = results.filter((s) => state.activeFilters.every((f) => s.tags.some((t) => t.name === f)));
    }

    // Category filter
    if (state.categoryFilter) {
        const catTags = AUTO_TAG_RULES.filter((r) => r.category === state.categoryFilter).flatMap((r) => r.tags);
        results = results.filter((s) => s.tags.some((t) => catTags.includes(t.name)));
    }

    // Favorites filter
    if (state.favoritesOnly) {
        results = results.filter((s) => s.favorite);
    }

    // Sort
    results.sort((a, b) => {
        const dir = state.sortDirection === 'asc' ? 1 : -1;
        switch (state.sortBy) {
            case 'name':
                return a.name.localeCompare(b.name) * dir;
            case 'bpm':
                return ((a.bpm ?? 0) - (b.bpm ?? 0)) * dir;
            case 'duration':
                return (a.durationSec - b.durationSec) * dir;
            case 'rating':
                return (a.rating - b.rating) * dir;
            case 'addedAt':
                return a.addedAt.localeCompare(b.addedAt) * dir;
            case 'lastUsedAt':
                return (a.lastUsedAt ?? '').localeCompare(b.lastUsedAt ?? '') * dir;
            case 'useCount':
                return (a.useCount - b.useCount) * dir;
            default:
                return 0;
        }
    });

    memo = { stateRef: state, fingerprint, result: results };
    return results;
}
