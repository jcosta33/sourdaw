import { inject } from '#/infra/di/inject';
import { createHandler } from '#/helpers/createHandler';
import { type AppAction } from '#/modules/Command';
import { nudgeClip } from '../../useCases/clipEditing/nudgeClip';
import type { ExtractAction } from '../types';

export const executeNudgeClip = inject({ nudgeClip })(
    ({ nudgeClip }) =>
        function executeNudgeClip(a: ExtractAction<AppAction, 'nudgeClip'>): void {
            nudgeClip(a.payload.clipId, a.payload.beats);
        }
);

export const handleNudgeClip = createHandler<'nudgeClip'>({
    execute: executeNudgeClip,
    describe: (a) => ({ label: `Nudge clip ${a.payload.beats > 0 ? 'right' : 'left'}` }),
    undoable: true,
});
