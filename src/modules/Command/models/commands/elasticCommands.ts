import { executeAppAction } from '../../useCases/executeAppAction';
import { getSelectedClipId } from '../../useCases/selectionHelpers/getSelectedClipId';
import { type CommandEntry } from '../CommandEntry';

export const elasticCommands: CommandEntry[] = [
    {
        id: 'elastic-detect-transients',
        label: 'Elastic: Detect Transients',
        description: 'Run transient detection on the selected audio clip',
        category: 'Editing',
        action: () => {
            const clipId = getSelectedClipId();
            if (clipId) {
                executeAppAction({ type: 'detectTransients', payload: { clipId } });
            }
        },
    },
    {
        id: 'elastic-open-editor',
        label: 'Elastic: Open Editor for Selected Clip',
        description: 'Open the Elastic Audio editor panel for the selected clip',
        category: 'Editing',
        action: () => {
            const clipId = getSelectedClipId();
            if (clipId) {
                executeAppAction({ type: 'openElasticEditor', payload: { clipId } });
            }
        },
    },
    {
        id: 'elastic-quantize',
        label: 'Elastic: Quantize Selected Clip',
        description: 'Snap detected transients on the selected clip to the grid',
        category: 'Editing',
        action: () => {
            const clipId = getSelectedClipId();
            if (clipId) {
                executeAppAction({ type: 'quantizeTransients', payload: { clipId } });
            }
        },
    },
];
