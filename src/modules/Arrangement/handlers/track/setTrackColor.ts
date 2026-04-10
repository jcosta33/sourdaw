import { inject } from '#/infra/di/inject';
import { type AppAction } from '#/modules/Command';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { createHandler } from '#/helpers/createHandler';
import { setTrackColor } from '#/modules/Arrangement/useCases/setTrackGainPan';
import type { ExtractAction } from '../types';

const executeSetTrackColor = inject({ setTrackColor })(
    ({ setTrackColor }) =>
        function executeSetTrackColor(a: ExtractAction<AppAction, 'setTrackColor'>): void {
            setTrackColor(a.payload.trackId, a.payload.color);
        }
);

export const handleSetTrackColor = createHandler<'setTrackColor'>({
    execute: executeSetTrackColor,
    describe: (a) => {
        const prev = getTrackStoreState()?.tracks.find((t) => t.id === a.payload.trackId);
        return {
            label: 'Set track color',
            inverseAction: prev
                ? { type: 'setTrackColor', payload: { trackId: a.payload.trackId, color: prev.color } }
                : null,
        };
    },
    undoable: true,
});
