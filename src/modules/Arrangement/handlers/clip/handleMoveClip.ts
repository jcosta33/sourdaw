import { inject } from '#/infra/di/inject';
import { createHandler } from '#/helpers/createHandler';
import { type AppAction } from '#/modules/Command';
import { moveClip } from '../../useCases/clip/moveClip';
import type { ExtractAction } from '../types';

export const executeMoveClip = inject({ moveClip })(
    ({ moveClip }) =>
        function executeMoveClip(a: ExtractAction<AppAction, 'moveClip'>): void {
            moveClip(a.payload.clipId, a.payload.trackId, a.payload.startBeat);
        }
);

export const handleMoveClip = createHandler<'moveClip'>({
    execute: executeMoveClip,
    describe: () => ({ label: 'Move clip' }),
    undoable: true,
});
