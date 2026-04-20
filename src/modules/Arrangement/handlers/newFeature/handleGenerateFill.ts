import { createHandler } from '#/utils/createHandler';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { generateDrumFill } from '../../useCases/fillTransitionGeneration/generation';

export const handleGenerateFill = createHandler<'generateFill'>({
    execute: (a) => {
        const fill = generateDrumFill(
            a.payload.atBeat,
            a.payload.durationBeats ?? 2,
            (a.payload.style ?? 'descending') as 'simple' | 'descending' | 'sixteenth' | 'syncopated'
        );
        notifyUser(`Generated ${fill.notes.length}-note drum fill`, 'success');
    },
    describe: () => ({ label: 'Generate Fill' }),
    undoable: true,
});
