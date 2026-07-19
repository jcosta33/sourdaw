import { normalizeGrooveAmount, resolveGrooveTemplateIdAlias } from '../../models/GrooveTemplate';
import {
    canonicalizeGrooveConsumerId,
    isGrooveTemplateAssignment,
    type GrooveConsumerType,
    type GrooveTemplateAssignment,
} from '../../models/GrooveTemplateState';

type CanonicalizeGrooveTemplateAssignmentInput = {
    consumerType: GrooveConsumerType;
    consumerId: string;
    templateId: string;
    amount: number;
};

export function canonicalizeGrooveTemplateAssignment(
    input: CanonicalizeGrooveTemplateAssignmentInput
): GrooveTemplateAssignment | null {
    const consumerId = canonicalizeGrooveConsumerId(input.consumerId);
    const templateId = resolveGrooveTemplateIdAlias(input.templateId);
    if (!consumerId || consumerId !== input.consumerId || !templateId) {
        return null;
    }
    const assignment = {
        consumerType: input.consumerType,
        consumerId,
        templateId,
        amount: normalizeGrooveAmount(input.amount),
    };
    return isGrooveTemplateAssignment(assignment) ? assignment : null;
}
