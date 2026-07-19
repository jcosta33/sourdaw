import { grooveTemplateStore } from '#/modules/MIDI/stores';
import { getScopedGrooveConsumerId, restoreGrooveAssignment } from '#/modules/MIDI/useCases';

import { YEAST_GROOVE_OWNER_ID } from './getYeastGrooveAssignment';

export function removeYeastGrooveAssignments(processorId: string): void {
    const state = grooveTemplateStore.value;
    if (!state) {
        return;
    }

    const consumerIds = new Set([
        processorId,
        getScopedGrooveConsumerId({ ownerId: YEAST_GROOVE_OWNER_ID, localId: processorId }),
    ]);
    for (const assignment of state.assignments) {
        if (assignment.consumerType !== 'yeast-processor' || !consumerIds.has(assignment.consumerId)) {
            continue;
        }
        restoreGrooveAssignment({
            consumerType: assignment.consumerType,
            consumerId: assignment.consumerId,
            assignment: null,
        });
    }
}
