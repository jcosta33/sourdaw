import { inject } from '#/infra/di/inject';
import { type AppAction } from '#/modules/Command';
import { createHandler } from '#/helpers/createHandler';
import { setTrackOutput } from '#/modules/Arrangement/useCases/toggleTrackState/setTrackOutput';
import type { ExtractAction } from '../types';

const executeSetTrackOutput = inject({ setTrackOutput })(
    ({ setTrackOutput }) =>
        function executeSetTrackOutput(a: ExtractAction<AppAction, 'setTrackOutput'>): void {
            setTrackOutput(a.payload.trackId, a.payload.outputId);
        }
);

export const handleSetTrackOutput = createHandler<'setTrackOutput'>({
    execute: executeSetTrackOutput,
    describe: () => ({ label: 'Set track output' }),
    undoable: true,
});
