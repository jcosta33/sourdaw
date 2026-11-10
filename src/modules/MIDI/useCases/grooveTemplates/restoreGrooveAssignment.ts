import { valuesEqual } from '#/utils/structuralEquality';

import {
    type GrooveConsumerType,
    type GrooveTemplateAssignment,
    grooveTemplateStore,
    isGrooveTemplateAssignment,
} from '../../stores/grooveTemplateStore';

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
}: RestoreGrooveAssignmentInput): { status: 'written' | 'no-write' } {
    const state = grooveTemplateStore.value;
    if (!state) {
        return { status: 'no-write' };
    }
    const existingIndex = state.assignments.findIndex(
        (candidate) => candidate.consumerType === consumerType && candidate.consumerId === consumerId
    );
    const currentAssignment = existingIndex === -1 ? null : state.assignments[existingIndex]!;
    if (expectedAssignment && !valuesEqual(currentAssignment, expectedAssignment)) {
        throw new Error('Cannot restore groove assignment: current value diverged from the action result');
    }
    if (assignment && !isGrooveTemplateAssignment(assignment)) {
        throw new Error('Cannot restore groove assignment: snapshot is not canonical');
    }
    if (valuesEqual(currentAssignment, assignment)) {
        return { status: 'no-write' };
    }
    if (!assignment) {
        grooveTemplateStore.set({
            ...state,
            assignments: state.assignments.filter(
                (candidate) => candidate.consumerType !== consumerType || candidate.consumerId !== consumerId
            ),
        });
        return { status: 'written' };
    }
    const assignments = [...state.assignments];
    if (existingIndex === -1) {
        assignments.push(structuredClone(assignment));
    } else {
        assignments[existingIndex] = structuredClone(assignment);
    }
    grooveTemplateStore.set({ ...state, assignments });
    return { status: 'written' };
}
