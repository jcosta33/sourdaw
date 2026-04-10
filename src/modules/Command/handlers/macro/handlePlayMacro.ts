import { createHandler } from '#/helpers/createHandler';
import { playMacro } from '../../useCases/macro/playback';

export const handlePlayMacro = createHandler<'playMacro'>({
    execute: async (action) => {
        await playMacro(action.payload.macroId);
    },
    describe: () => ({ label: 'Play Macro' }),
    undoable: false,
});
