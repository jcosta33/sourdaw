import { normalizeGrooveAmount } from '../../models/GrooveTemplate';
import {
    type GrooveConsumerType,
    type GrooveTemplateAssignment,
    grooveTemplateStore,
} from '../../stores/grooveTemplateStore';

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
    if (input.consumerId.length === 0) {
        return { ok: false, error: { code: 'invalid-consumer-id' } };
    }
    if (!state.templates.some((template) => template.id === input.templateId)) {
        return { ok: false, error: { code: 'missing-template', templateId: input.templateId } };
    }
    const assignment: GrooveTemplateAssignment = {
        consumerType: input.consumerType,
        consumerId: input.consumerId,
        templateId: input.templateId,
        amount: normalizeGrooveAmount(input.amount),
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
    markGrooveTemplateProjectWrite();
    return { ok: true, assignment };
}
