import {
    type GrooveConsumerType,
    type GrooveTemplateAssignment,
    grooveTemplateStore,
} from '../../stores/grooveTemplateStore';

type RestoreGrooveAssignmentInput = {
    consumerType: GrooveConsumerType;
    consumerId: string;
    assignment: GrooveTemplateAssignment | null;
};

export function restoreGrooveAssignment({ consumerType, consumerId, assignment }: RestoreGrooveAssignmentInput): void {
    const state = grooveTemplateStore.value;
    if (!state) {
        return;
    }
    const existingIndex = state.assignments.findIndex(
        (candidate) => candidate.consumerType === consumerType && candidate.consumerId === consumerId
    );
    if (!assignment) {
        grooveTemplateStore.set({
            ...state,
            assignments: state.assignments.filter(
                (candidate) => candidate.consumerType !== consumerType || candidate.consumerId !== consumerId
            ),
        });
        return;
    }
    const assignments = [...state.assignments];
    if (existingIndex === -1) {
        assignments.push(structuredClone(assignment));
    } else {
        assignments[existingIndex] = structuredClone(assignment);
    }
    grooveTemplateStore.set({ ...state, assignments });
}
