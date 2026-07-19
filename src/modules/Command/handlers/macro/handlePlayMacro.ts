import { createHandler } from '#/utils/createHandler';

import { playMacro } from '../../useCases/macro/playback';

export const handlePlayMacro = createHandler<'playMacro'>({
    execute: async (action, context) => {
        if (!context) {
            throw new Error('Command execution context is required to play a macro');
        }
        await playMacro({
            macroId: action.payload.macroId,
            runExecuteAppAction: context.executeAppAction,
        });
    },
    describe: () => ({ label: 'Play Macro' }),
    undoable: false,
});
