import { inject } from '#/infra/di/inject';
import { type AppAction } from '#/modules/Command';
import { setTrackInput } from '../../useCases/setTrackInput';
import { createHandler } from '#/helpers/createHandler';
import type { ExtractAction } from '../types';

const executeSetTrackInput = inject({ setTrackInput })(
    ({ setTrackInput }) =>
        function executeSetTrackInput(a: ExtractAction<AppAction, 'setTrackInput'>): void {
            setTrackInput(a.payload.trackId, a.payload.inputId);
        }
);

export const handleSetTrackInput = createHandler<'setTrackInput'>({
    execute: executeSetTrackInput,
    describe: () => ({ label: 'Set track input' }),
    undoable: true,
});
