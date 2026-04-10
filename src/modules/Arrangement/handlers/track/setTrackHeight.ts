import { inject } from '#/infra/di/inject';
import { type AppAction } from '#/modules/Command';
import { createHandler } from '#/helpers/createHandler';
import { setTrackHeight } from '#/modules/Arrangement/useCases/toggleTrackState/setTrackHeight';
import type { ExtractAction } from '../types';

const executeSetTrackHeight = inject({ setTrackHeight })(
    ({ setTrackHeight }) =>
        function executeSetTrackHeight(a: ExtractAction<AppAction, 'setTrackHeight'>): void {
            setTrackHeight(a.payload.trackId, a.payload.height);
        }
);

export const handleSetTrackHeight = createHandler<'setTrackHeight'>({
    execute: executeSetTrackHeight,
    describe: () => ({ label: 'Set track height' }),
    undoable: true,
});
