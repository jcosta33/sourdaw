import { createHandler } from '#/utils/createHandler';
import { clearSolos } from '#/modules/Arrangement/useCases/toggleTrackState/clearSolos';

export const handleClearSolos = createHandler<'clearSolos'>({
    execute: () => {
        clearSolos();
    },
    describe: () => ({ label: 'Clear all solos' }),
    undoable: true,
});
