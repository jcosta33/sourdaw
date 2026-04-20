import { setMpeEnabled } from '#/modules/AudioEngine/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleDisableMpe = createHandler<'disableMpe'>({
    execute: () => {
        setMpeEnabled(false);
    },
    describe: () => ({ label: 'Disable MPE' }),
    undoable: false,
});
