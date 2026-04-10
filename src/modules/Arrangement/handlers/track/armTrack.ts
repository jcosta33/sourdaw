import { inject } from '#/infra/di/inject';
import { type AppAction } from '#/modules/Command';
import { createHandler } from '#/helpers/createHandler';
import { armTrack } from '#/modules/Arrangement/useCases/recording';
import type { ExtractAction } from '../types';

const executeArmTrack = inject({ armTrack })(
    ({ armTrack }) =>
        function executeArmTrack(a: ExtractAction<AppAction, 'armTrack'>): void {
            armTrack(a.payload.trackId, a.payload.armed);
        }
);

export const handleArmTrack = createHandler<'armTrack'>({
    execute: executeArmTrack,
    describe: (a) => ({ label: a.payload.armed ? 'Arm track' : 'Disarm track' }),
    undoable: true,
});
