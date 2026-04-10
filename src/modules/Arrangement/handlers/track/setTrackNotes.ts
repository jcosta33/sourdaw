import { inject } from '#/infra/di/inject';
import { type AppAction } from '#/modules/Command';
import { createHandler } from '#/helpers/createHandler';
import { setTrackNotes } from '#/modules/Arrangement/useCases/setTrackGainPan';
import type { ExtractAction } from '../types';

const executeSetTrackNotes = inject({ setTrackNotes })(
    ({ setTrackNotes }) =>
        function executeSetTrackNotes(a: ExtractAction<AppAction, 'setTrackNotes'>): void {
            setTrackNotes(a.payload.trackId, a.payload.notes);
        }
);

export const handleSetTrackNotes = createHandler<'setTrackNotes'>({
    execute: executeSetTrackNotes,
    describe: () => {
        return { label: 'Set track notes' };
    },
    undoable: true,
});
