import { batchStoreUpdates } from '#/infra/store/createStore';
import { grooveTemplateStore } from '#/modules/MIDI/stores';
import { getScopedGrooveConsumerId, restoreGrooveAssignment } from '#/modules/MIDI/useCases';

import { readAllYeastRacks } from '../stores/yeastStore';

import { YEAST_GROOVE_OWNER_ID } from './getYeastGrooveAssignment';

export function reconcileYeastGrooveAssignments(): void {
    const grooveState = grooveTemplateStore.value;
    if (!grooveState) {
        return;
    }

    // The live-consumer set is the union of groove processors across EVERY
    // device rack, not just the active one: this runs on every rack commit
    // and on project hydration, and a single-rack view would strip the
    // groove assignments of every other device — then persist the loss on
    // the next save.
    const liveConsumerIds = new Set<string>();
    for (const rack of readAllYeastRacks()) {
        for (const processor of rack.processors) {
            if (processor.type !== 'groove') {
                continue;
            }
            liveConsumerIds.add(processor.id);
            liveConsumerIds.add(getScopedGrooveConsumerId({ ownerId: YEAST_GROOVE_OWNER_ID, localId: processor.id }));
        }
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
