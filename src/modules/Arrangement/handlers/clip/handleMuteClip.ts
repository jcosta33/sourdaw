import { inject } from '#/infra/di/inject';
import { createHandler } from '#/helpers/createHandler';
import { type AppAction } from '#/modules/Command';
import { muteClip } from '../../useCases/clipEditing/muteClip';
import type { ExtractAction } from '../types';

export const executeMuteClip = inject({ muteClip })(
    ({ muteClip }) =>
        function executeMuteClip(a: ExtractAction<AppAction, 'muteClip'>): void {
            muteClip(a.payload.clipId, a.payload.muted);
        }
);

export const handleMuteClip = createHandler<'muteClip'>({
    execute: executeMuteClip,
    describe: (a) => ({ label: a.payload.muted ? 'Mute clip' : 'Unmute clip' }),
    undoable: true,
});
