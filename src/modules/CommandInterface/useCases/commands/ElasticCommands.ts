import { defaultTimelineEditingState, timelineEditingStore } from '#/modules/Arrangement/stores';

import { executeCommandAction } from '../executeCommandAction';
import { type CallableCommandEntry } from '../searchCommandRegistry';
import { getSelectedClipIdOfType } from '../selectionHelpers/getSelectedClipIdOfType';

export const elasticCommands: CallableCommandEntry[] = [
    {
        id: 'elastic-detect-transients',
        label: 'Elastic: Detect Transients',
        description: 'Run transient detection on the selected audio clip',
        category: 'Editing',
        getInapplicabilityReason: (context) =>
            getSelectedClipIdOfType('audio', context) ? null : 'Select an audio clip first.',
        action: (onCommitted?: () => void) => {
            const clipId = getSelectedClipIdOfType('audio');
            if (clipId) {
                void executeCommandAction(onCommitted, { type: 'detectTransients', payload: { clipId } });
            }
        },
    },
    {
        id: 'elastic-open-editor',
        label: 'Elastic: Open Editor for Selected Clip',
        description: 'Open the Elastic Audio editor panel for the selected clip',
        category: 'Editing',
        getInapplicabilityReason: (context) =>
            getSelectedClipIdOfType('audio', context) ? null : 'Select an audio clip first.',
        action: (onCommitted?: () => void) => {
            const clipId = getSelectedClipIdOfType('audio');
            if (clipId) {
                void executeCommandAction(onCommitted, { type: 'openElasticEditor', payload: { clipId } });
            }
        },
    },
    {
        id: 'elastic-quantize',
        label: 'Elastic: Quantize Selected Clip',
        description: 'Cut the selected clip at its transients and move each hit onto the snap grid',
        category: 'Editing',
        getInapplicabilityReason: (context) =>
            getSelectedClipIdOfType('audio', context) ? null : 'Select an audio clip first.',
        action: (onCommitted?: () => void) => {
            const clipId = getSelectedClipIdOfType('audio');
            if (clipId) {
                const gridSize = (timelineEditingStore.value ?? defaultTimelineEditingState).snapValue;
                void executeCommandAction(onCommitted, { type: 'quantizeTransients', payload: { clipId, gridSize } });
            }
        },
    },
];
