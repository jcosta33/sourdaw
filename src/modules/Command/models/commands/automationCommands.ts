import { type CommandEntry } from '../CommandRegistry';
import { executeAppAction } from '#/modules/Command/useCases/executeAppAction';
import { automationStore } from '#/modules/Automation/stores/automationStore';

/** Automation commands — scale, invert, thin automation points. */
export const automationCommands: CommandEntry[] = [
    {
        id: 'scale-automation',
        label: 'Scale Automation',
        description: 'Scale automation values by a factor',
        category: 'Automation',
        action: () => {
            const lane = automationStore.value?.lanes[0];
            if (lane) {
                executeAppAction({ type: 'scaleAutomation', payload: { laneId: lane.id, factor: 1.2 } });
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
                executeAppAction({ type: 'invertAutomation', payload: { laneId: lane.id } });
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
                executeAppAction({ type: 'thinAutomation', payload: { laneId: lane.id } });
            }
        },
    },
];
