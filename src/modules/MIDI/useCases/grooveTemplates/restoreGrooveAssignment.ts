import {
    type GrooveConsumerType,
    type GrooveTemplateAssignment,
    grooveTemplateStore,
    isGrooveTemplateAssignment,
} from '../../stores/grooveTemplateStore';

import { markGrooveTemplateProjectWrite } from './markGrooveTemplateProjectWrite';

type RestoreGrooveAssignmentInput = {
    consumerType: GrooveConsumerType;
    consumerId: string;
    assignment: GrooveTemplateAssignment | null;
    expectedAssignment?: GrooveTemplateAssignment;
};

export function restoreGrooveAssignment({
    consumerType,
    consumerId,
    assignment,
    expectedAssignment,
}: RestoreGrooveAssignmentInput): void {
    const state = grooveTemplateStore.value;
    if (!state) {
        return;
    }
    const existingIndex = state.assignments.findIndex(
        (candidate) => candidate.consumerType === consumerType && candidate.consumerId === consumerId
    );
    const currentAssignment = existingIndex === -1 ? null : state.assignments[existingIndex]!;
    if (expectedAssignment && JSON.stringify(currentAssignment) !== JSON.stringify(expectedAssignment)) {
        throw new Error('Cannot restore groove assignment: current value diverged from the action result');
    }
    if (assignment && !isGrooveTemplateAssignment(assignment)) {
        throw new Error('Cannot restore groove assignment: snapshot is not canonical');
    }
    if (!assignment) {
        grooveTemplateStore.set({
            ...state,
            assignments: state.assignments.filter(
                (candidate) => candidate.consumerType !== consumerType || candidate.consumerId !== consumerId
            ),
        });
        markGrooveTemplateProjectWrite();
        return;
    }
    const assignments = [...state.assignments];
    if (existingIndex === -1) {
        assignments.push(structuredClone(assignment));
    } else {
        assignments[existingIndex] = structuredClone(assignment);
    }
    grooveTemplateStore.set({ ...state, assignments });
    markGrooveTemplateProjectWrite();
}
