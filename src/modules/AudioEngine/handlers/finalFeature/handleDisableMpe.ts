import { createHandler } from '#/utils/createHandler';

import { setMpeEnabled } from '../../useCases/webMidiInput/setMpeEnabled';

export const handleDisableMpe = createHandler<'disableMpe'>({
    execute: () => {
        setMpeEnabled(false);
    },
    describe: () => ({ label: 'Disable MPE' }),
    undoable: false,
});
