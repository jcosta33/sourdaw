import { inject } from '#/infra/di/inject';
import { type AppAction } from '#/modules/Command';
import { createHandler } from '#/helpers/createHandler';
import { soloTrack } from '#/modules/Arrangement/useCases/toggleTrackState/soloTrack';
import type { ExtractAction } from '../types';

const executeSoloTrack = inject({ soloTrack })(
    ({ soloTrack }) =>
        function executeSoloTrack(a: ExtractAction<AppAction, 'soloTrack'>): void {
            soloTrack(a.payload.trackId, a.payload.soloed);
        }
);

export const handleSoloTrack = createHandler<'soloTrack'>({
    execute: executeSoloTrack,
    describe: (a) => ({
        label: a.payload.soloed ? 'Solo track' : 'Unsolo track',
        inverseAction: { type: 'soloTrack', payload: { trackId: a.payload.trackId, soloed: !a.payload.soloed } },
    }),
    undoable: true,
});
