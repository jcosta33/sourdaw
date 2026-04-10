import { inject } from '#/infra/di/inject';
import { setTrackPan as engineSetTrackPan } from '#/modules/AudioEngine';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { type AppAction } from '#/modules/Command';
import { createHandler } from '#/helpers/createHandler';
import { setTrackPan } from '#/modules/Arrangement/useCases/setTrackGainPan';
import type { ExtractAction } from '../types';

const executeSetTrackPan = inject({ setTrackPan, engineSetTrackPan })(
    ({ setTrackPan, engineSetTrackPan }) =>
        function executeSetTrackPan(a: ExtractAction<AppAction, 'setTrackPan'>): void {
            setTrackPan(a.payload.trackId, a.payload.pan);
            engineSetTrackPan(a.payload.trackId, a.payload.pan);
        }
);

export const handleSetTrackPan = createHandler<'setTrackPan'>({
    execute: executeSetTrackPan,
    describe: (a) => {
        const prev = getTrackStoreState()?.tracks.find((t) => t.id === a.payload.trackId);
        return {
            label: 'Set track pan',
            inverseAction: prev
                ? { type: 'setTrackPan', payload: { trackId: a.payload.trackId, pan: prev.pan } }
                : null,
        };
    },
    undoable: true,
});
