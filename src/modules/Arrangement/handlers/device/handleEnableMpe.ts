import { createHandler } from '#/utils/createHandler';
import { setMpeEnabled } from '#/modules/AudioEngine/useCases';

export const handleEnableMpe = createHandler<'enableMpe'>({
    execute: () => {
        setMpeEnabled(true);
    },
    describe: () => ({ label: 'Enable MPE' }),
    undoable: false,
});
