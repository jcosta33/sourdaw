import { createHandler } from '#/utils/createHandler';
import { setMpeEnabled } from '#/modules/AudioEngine/useCases';

export const handleDisableMpe = createHandler<'disableMpe'>({
    execute: () => {
        setMpeEnabled(false);
    },
    describe: () => ({ label: 'Disable MPE' }),
    undoable: false,
});
