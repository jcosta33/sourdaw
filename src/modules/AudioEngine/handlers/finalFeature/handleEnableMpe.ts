import { createHandler } from '#/utils/createHandler';

import { setMpeEnabled } from '../../useCases/webMidiInput/setMpeEnabled';

export const handleEnableMpe = createHandler<'enableMpe'>({
    execute: () => {
        setMpeEnabled(true);
    },
    describe: () => ({ label: 'Enable MPE' }),
    undoable: false,
});
