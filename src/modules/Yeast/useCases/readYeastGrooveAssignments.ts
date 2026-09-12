import { grooveTemplateStore } from '#/modules/MIDI/stores';
import { getScopedGrooveConsumerId } from '#/modules/MIDI/useCases';

import { YEAST_GROOVE_OWNER_ID } from './getYeastGrooveAssignment';

/**
 * Every groove assignment bound to one Yeast processor — under the scoped
 * consumer id and, for documents written before scoping, the legacy bare
 * processor id — verbatim as the store holds them. This is the capture half of
 * `removeYeastGrooveAssignments`: whatever this reads is exactly what a
 * processor removal deletes, so the remove-inverse can restore it (#4124).
 */
export function readYeastGrooveAssignments(processorId: string) {
    const state = grooveTemplateStore.value;
    if (!state) {
        return [];
    }

    const consumerIds = new Set([
        processorId,
        getScopedGrooveConsumerId({ ownerId: YEAST_GROOVE_OWNER_ID, localId: processorId }),
    ]);
    return state.assignments.filter(
        (assignment) => assignment.consumerType === 'yeast-processor' && consumerIds.has(assignment.consumerId)
    );
}
