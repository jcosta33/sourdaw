/**
 * Sample database store — manages sample library state.
 *
 * Types are defined in models/SampleEntry.ts.
 * Extracted from sampleDatabaseUseCases.ts — stores should live in stores/.
 */

import { createStore } from '#/infra/store/createStore';

import { type SampleTag, type SampleEntry, type SampleCategory, type SampleDatabaseState } from '../models/SampleEntry';

export type { SampleTag, SampleEntry, SampleCategory, SampleDatabaseState };

export const sampleDatabaseStore = createStore<SampleDatabaseState>({
    initialData: {
        samples: [],
        searchQuery: '',
        activeFilters: [],
        categoryFilter: null,
        sortBy: 'name',
        sortDirection: 'asc',
        favoritesOnly: false,
    },
});
