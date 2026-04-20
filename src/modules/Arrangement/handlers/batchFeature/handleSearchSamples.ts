import { searchSamples } from '#/modules/SoundLibrary/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleSearchSamples = createHandler<'searchSamples'>({
    execute: (a) => {
        searchSamples(a.payload.query);
    },
    describe: () => ({ label: 'Search Samples' }),
    undoable: false,
});
