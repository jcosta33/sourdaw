import { inject } from '#/infra/di/inject';
import { type AppAction } from '#/modules/Command';
import { createHandler } from '#/helpers/createHandler';
import { muteTrack } from '#/modules/Arrangement/useCases/toggleTrackState/muteTrack';
import type { ExtractAction } from '../types';

const executeMuteTrack = inject({ muteTrack })(
    ({ muteTrack }) =>
        function executeMuteTrack(a: ExtractAction<AppAction, 'muteTrack'>): void {
            muteTrack(a.payload.trackId, a.payload.muted);
        }
);

export const handleMuteTrack = createHandler<'muteTrack'>({
    execute: executeMuteTrack,
    describe: (a) => ({
        label: a.payload.muted ? 'Mute track' : 'Unmute track',
        inverseAction: { type: 'muteTrack', payload: { trackId: a.payload.trackId, muted: !a.payload.muted } },
    }),
    undoable: true,
});
