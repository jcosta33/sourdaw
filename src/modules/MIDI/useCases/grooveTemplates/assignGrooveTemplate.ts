import {
    type GrooveConsumerType,
    type GrooveTemplateAssignment,
    grooveTemplateStore,
} from '../../stores/grooveTemplateStore';

import { canonicalizeGrooveTemplateAssignment } from './canonicalizeGrooveTemplateAssignment';
import { markGrooveTemplateProjectWrite } from './markGrooveTemplateProjectWrite';

type AssignGrooveTemplateInput = {
    consumerType: GrooveConsumerType;
    consumerId: string;
    templateId: string;
    amount: number;
};

type AssignGrooveTemplateResult =
    | { ok: true; assignment: GrooveTemplateAssignment }
    | { ok: false; error: { code: 'state-unavailable' } }
    | { ok: false; error: { code: 'invalid-consumer-id' } }
    | { ok: false; error: { code: 'missing-template'; templateId: string } };

export function assignGrooveTemplate(input: AssignGrooveTemplateInput): AssignGrooveTemplateResult {
    const state = grooveTemplateStore.value;
    if (!state) {
        return { ok: false, error: { code: 'state-unavailable' } };
    }
    const assignment = canonicalizeGrooveTemplateAssignment(input);
    if (!assignment) {
        return { ok: false, error: { code: 'invalid-consumer-id' } };
    }
    if (!state.templates.some((template) => template.id === assignment.templateId)) {
        return { ok: false, error: { code: 'missing-template', templateId: input.templateId } };
    }
    const existingIndex = state.assignments.findIndex(
        (candidate) => candidate.consumerType === input.consumerType && candidate.consumerId === assignment.consumerId
    );
    const existingAssignment = existingIndex === -1 ? undefined : state.assignments[existingIndex];
    if (
        existingAssignment?.consumerType === assignment.consumerType &&
        existingAssignment.consumerId === assignment.consumerId &&
        existingAssignment.templateId === assignment.templateId &&
        existingAssignment.amount === assignment.amount
    ) {
        return { ok: true, assignment };
    }
    const assignments = [...state.assignments];
    if (existingIndex === -1) {
        assignments.push(assignment);
    } else {
        assignments[existingIndex] = assignment;
    }
    grooveTemplateStore.set({ ...state, assignments });
    markGrooveTemplateProjectWrite();
    return { ok: true, assignment };
}
