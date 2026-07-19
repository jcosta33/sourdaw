import { STRAIGHT_GROOVE_TEMPLATE_ID } from '../../models/GrooveTemplate';
import {
    type GrooveConsumerType,
    type GrooveTemplateAssignment,
    grooveTemplateStore,
} from '../../stores/grooveTemplateStore';

type AssignGrooveTemplateInput = {
    consumerType: GrooveConsumerType;
    consumerId: string;
    templateId: string;
    amount: number;
};

export function assignGrooveTemplate(input: AssignGrooveTemplateInput): GrooveTemplateAssignment | null {
    const state = grooveTemplateStore.value;
    if (!state || input.consumerId.length === 0) {
        return null;
    }
    const assignment: GrooveTemplateAssignment = {
        consumerType: input.consumerType,
        consumerId: input.consumerId,
        templateId: state.templates.some((template) => template.id === input.templateId)
            ? input.templateId
            : STRAIGHT_GROOVE_TEMPLATE_ID,
        amount: Math.max(0, Math.min(1, input.amount)),
    };
    const existingIndex = state.assignments.findIndex(
        (candidate) => candidate.consumerType === input.consumerType && candidate.consumerId === input.consumerId
    );
    const assignments = [...state.assignments];
    if (existingIndex === -1) {
        assignments.push(assignment);
    } else {
        assignments[existingIndex] = assignment;
    }
    grooveTemplateStore.set({ ...state, assignments });
    return assignment;
}
