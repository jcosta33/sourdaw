import { batchStoreUpdates } from '#/infra/store/createStore';
import { grooveTemplateStore } from '#/modules/MIDI/stores';
import { restoreGrooveAssignment } from '#/modules/MIDI/useCases';
import { type YeastGrooveAssignmentSnapshot } from '#/utils/handlerContract';

/**
 * The write half of the #4124 capture/restore pair: re-binds the groove
 * assignments a processor removal deleted. A direct store write through
 * `restoreGrooveAssignment`, never a nested `assignGrooveTemplate` dispatch —
 * the undo engine already records the removal's inverse, and a nested undoable
 * action would double-record the gesture.
 */
export function restoreYeastGrooveAssignments(assignments: readonly YeastGrooveAssignmentSnapshot[]): boolean {
    const state = grooveTemplateStore.value;
    if (!state || assignments.length === 0) {
        return false;
    }

    let grooveChanged = false;
    batchStoreUpdates(() => {
        for (const assignment of assignments) {
            const result = restoreGrooveAssignment({
                consumerType: assignment.consumerType,
                consumerId: assignment.consumerId,
                assignment,
            });
            grooveChanged = result.status === 'written' || grooveChanged;
        }
    });
    return grooveChanged;
}
