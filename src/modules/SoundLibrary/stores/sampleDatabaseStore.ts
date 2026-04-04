/**
 * Sample database store — manages sample library state.
 *
 * Types are defined in models/SampleEntry.ts.
 * Extracted from sampleDatabaseUseCases.ts — stores should live in stores/.
 */

import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';
import {
    type SampleTag,
    type SampleEntry,
    type SampleCategory,
    type SampleDatabaseState,
} from '../models/SampleEntry';

export type { SampleTag, SampleEntry, SampleCategory, SampleDatabaseState };

const logger = Container.getInstance().get(Logger);

export const sampleDatabaseStore = new Store<SampleDatabaseState>(logger, {
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
