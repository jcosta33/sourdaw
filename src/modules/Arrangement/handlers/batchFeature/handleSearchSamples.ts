import { createHandler } from '#/helpers/createHandler';
import { searchSamples } from '#/modules/SoundLibrary/useCases';

export const handleSearchSamples = createHandler<'searchSamples'>({
    execute: (a) => {
        searchSamples(a.payload.query);
    },
    describe: () => ({ label: 'Search Samples' }),
    undoable: false,
});
