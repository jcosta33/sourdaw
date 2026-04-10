import { inject } from '#/infra/di/inject';
import { type AppAction } from '#/modules/Command';
import { createHandler } from '#/helpers/createHandler';
import { freezeTrack } from '#/modules/Arrangement/useCases/freezeBounce/freezeTrack';
import type { ExtractAction } from '../types';

const executeFreezeTrack = inject({ freezeTrack })(
    ({ freezeTrack }) =>
        async function executeFreezeTrack(a: ExtractAction<AppAction, 'freezeTrack'>): Promise<void> {
            await freezeTrack(a.payload.trackId);
        }
);

export const handleFreezeTrack = createHandler<'freezeTrack'>({
    execute: executeFreezeTrack,
    describe: () => ({ label: 'Freeze track' }),
    undoable: true,
});
