import { inject } from '#/infra/di/inject';
import { createHandler } from '#/helpers/createHandler';
import { type AppAction } from '#/modules/Command';
import { crossfadeClips } from '../../useCases/clipEditing/crossfadeClips';
import type { ExtractAction } from '../types';

export const executeCrossfadeClips = inject({ crossfadeClips })(
    ({ crossfadeClips }) =>
        function executeCrossfadeClips(a: ExtractAction<AppAction, 'crossfadeClips'>): void {
            crossfadeClips(a.payload.clipAId, a.payload.clipBId, a.payload.durationBeats);
        }
);

export const handleCrossfadeClips = createHandler<'crossfadeClips'>({
    execute: executeCrossfadeClips,
    describe: () => ({ label: 'Crossfade clips' }),
    undoable: true,
});
