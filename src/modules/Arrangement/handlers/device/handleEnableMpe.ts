import { setMpeEnabled } from '#/modules/AudioEngine/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleEnableMpe = createHandler<'enableMpe'>({
    execute: () => {
        setMpeEnabled(true);
    },
    describe: () => ({ label: 'Enable MPE' }),
    undoable: false,
});
