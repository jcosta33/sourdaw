import { inject } from '#/infra/di/inject';
import { type AppAction } from '#/modules/Command';
import { createHandler } from '#/helpers/createHandler';
import { duplicateTrack } from '#/modules/Arrangement/useCases/duplicateTrack';
import type { ExtractAction } from '../types';

const executeDuplicateTrack = inject({ duplicateTrack })(
    ({ duplicateTrack }) =>
        function executeDuplicateTrack(a: ExtractAction<AppAction, 'duplicateTrack'>): void {
            duplicateTrack(a.payload.trackId);
        }
);

export const handleDuplicateTrack = createHandler<'duplicateTrack'>({
    execute: executeDuplicateTrack,
    describe: () => ({ label: 'Duplicate track' }),
    undoable: true,
});
