import { inject } from '#/infra/di/inject';
import { type AppAction } from '#/modules/Command';
import { createHandler } from '#/helpers/createHandler';
import { hideTrack } from '#/modules/Arrangement/useCases/toggleTrackState/hideTrack';
import type { ExtractAction } from '../types';

const executeHideTrack = inject({ hideTrack })(
    ({ hideTrack }) =>
        function executeHideTrack(a: ExtractAction<AppAction, 'hideTrack'>): void {
            hideTrack(a.payload.trackId, a.payload.hidden);
        }
);

export const handleHideTrack = createHandler<'hideTrack'>({
    execute: executeHideTrack,
    describe: (a) => ({ label: a.payload.hidden ? 'Hide track' : 'Show track' }),
    undoable: true,
});
