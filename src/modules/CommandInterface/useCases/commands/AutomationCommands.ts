import { automationStore } from '#/modules/Automation/stores';
import { executeUserAppAction } from '#/modules/Command/useCases';

import { type CallableCommandEntry } from '../searchCommandRegistry';

/** Automation commands — scale, invert, thin automation points. */
export const automationCommands: CallableCommandEntry[] = [
    {
        id: 'scale-automation',
        label: 'Scale Automation',
        description: 'Scale automation values by a factor',
        category: 'Automation',
        action: () => {
            const lane = automationStore.value?.lanes[0];
            if (lane) {
                void executeUserAppAction({ type: 'scaleAutomation', payload: { laneId: lane.id, factor: 1.2 } });
            }
        },
    },
    {
        id: 'invert-automation',
        label: 'Invert Automation',
        description: 'Invert automation values around the center',
        category: 'Automation',
        action: () => {
            const lane = automationStore.value?.lanes[0];
            if (lane) {
                void executeUserAppAction({ type: 'invertAutomation', payload: { laneId: lane.id } });
            }
        },
    },
    {
        id: 'thin-automation',
        label: 'Thin Automation Points',
        description: 'Reduce automation point density while preserving shape',
        category: 'Automation',
        action: () => {
            const lane = automationStore.value?.lanes[0];
            if (lane) {
                void executeUserAppAction({ type: 'thinAutomation', payload: { laneId: lane.id } });
            }
        },
    },
];
