import { createHandler } from '#/utils/createHandler';
import { toggleCountIn } from '../../useCases/transportControls/toggleCountIn';

export const handleToggleCountIn = createHandler<'toggleCountIn'>({
    execute: () => {
        toggleCountIn();
    },
    describe: () => ({ label: 'Toggle count-in' }),
    undoable: true,
});
