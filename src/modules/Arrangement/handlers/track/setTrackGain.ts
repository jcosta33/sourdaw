import { inject } from '#/infra/di/inject';
import { setTrackGain as engineSetTrackGain } from '#/modules/AudioEngine';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { type AppAction } from '#/modules/Command';
import { createHandler } from '#/helpers/createHandler';
import { setTrackGain } from '#/modules/Arrangement/useCases/setTrackGainPan';
import type { ExtractAction } from '../types';

const executeSetTrackGain = inject({ setTrackGain, engineSetTrackGain })(
    ({ setTrackGain, engineSetTrackGain }) =>
        function executeSetTrackGain(a: ExtractAction<AppAction, 'setTrackGain'>): void {
            setTrackGain(a.payload.trackId, a.payload.gain);
            engineSetTrackGain(a.payload.trackId, a.payload.gain);
        }
);

export const handleSetTrackGain = createHandler<'setTrackGain'>({
    execute: executeSetTrackGain,
    describe: (a) => {
        const prev = getTrackStoreState()?.tracks.find((t) => t.id === a.payload.trackId);
        return {
            label: 'Set track gain',
            inverseAction: prev
                ? { type: 'setTrackGain', payload: { trackId: a.payload.trackId, gain: prev.gain } }
                : null,
        };
    },
    undoable: true,
});
