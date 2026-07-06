import { createHandler } from '#/utils/createHandler';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { generateDrumFill } from '../../useCases/fillTransitionGeneration/generateDrumFill';

export const handleGenerateFill = createHandler<'generateFill'>({
    execute: (alpha) => {
        const fill = generateDrumFill(
            alpha.payload.atBeat,
            alpha.payload.durationBeats ?? 2,
            (alpha.payload.style ?? 'descending') as 'simple' | 'descending' | 'sixteenth' | 'syncopated'
        );
        notifyUser(`Generated ${fill.notes.length}-note drum fill`, 'success');
    },
    describe: () => ({ label: 'Generate Fill' }),
    undoable: true,
});
