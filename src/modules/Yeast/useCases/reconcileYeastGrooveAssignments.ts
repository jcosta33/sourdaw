import { batchStoreUpdates } from '#/infra/store/createStore';
import { grooveTemplateStore } from '#/modules/MIDI/stores';
import { getScopedGrooveConsumerId, restoreGrooveAssignment } from '#/modules/MIDI/useCases';

import { yeastStore } from '../stores/yeastStore';

import { YEAST_GROOVE_OWNER_ID } from './getYeastGrooveAssignment';

export function reconcileYeastGrooveAssignments(): void {
    const yeastState = yeastStore.value;
    const grooveState = grooveTemplateStore.value;
    if (!yeastState || !grooveState) {
        return;
    }

    const liveConsumerIds = new Set<string>();
    for (const processor of yeastState.processors) {
        if (processor.type !== 'groove') {
            continue;
        }
        liveConsumerIds.add(processor.id);
        liveConsumerIds.add(getScopedGrooveConsumerId({ ownerId: YEAST_GROOVE_OWNER_ID, localId: processor.id }));
    }

    batchStoreUpdates(() => {
        for (const assignment of grooveState.assignments) {
            if (assignment.consumerType !== 'yeast-processor' || liveConsumerIds.has(assignment.consumerId)) {
                continue;
            }
            restoreGrooveAssignment({
                consumerType: assignment.consumerType,
                consumerId: assignment.consumerId,
                assignment: null,
            });
        }
    });
}
