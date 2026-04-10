import { inject } from '#/infra/di/inject';
import { createHandler } from '#/helpers/createHandler';
import { type AppAction } from '#/modules/Command';
import { glueClips } from '../../useCases/clipEditing/glueClips';
import type { ExtractAction } from '../types';

export const executeGlueClips = inject({ glueClips })(
    ({ glueClips }) =>
        function executeGlueClips(a: ExtractAction<AppAction, 'glueClips'>): void {
            glueClips(a.payload.clipIds);
        }
);

export const handleGlueClips = createHandler<'glueClips'>({
    execute: executeGlueClips,
    describe: () => ({ label: 'Glue clips' }),
    undoable: true,
});
