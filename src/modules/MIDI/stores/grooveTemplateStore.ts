import { createStore } from '#/infra/store/createStore';
import { createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage';

import {
    STRAIGHT_GROOVE_TEMPLATE_ID,
    createStraightGrooveTemplate,
    isGrooveTemplate,
    normalizeGrooveAmount,
    resolveGrooveTemplateNameCollision,
    type GrooveTemplate,
} from '../models/GrooveTemplate';

const DOC_PREFIX_ROOT = 'root';

export const GROOVE_CONSUMER_TYPES = [
    'clip',
    'yeast-processor',
    'toaster-pattern',
    'arpeggiator',
    'sequencer',
] as const;

export type GrooveConsumerType = (typeof GROOVE_CONSUMER_TYPES)[number];

export type GrooveTemplateAssignment = {
    consumerType: GrooveConsumerType;
    consumerId: string;
    templateId: string;
    amount: number;
};

export type GrooveTemplateState = {
    templates: GrooveTemplate[];
    assignments: GrooveTemplateAssignment[];
};

export const defaultGrooveTemplateState: GrooveTemplateState = {
    templates: [createStraightGrooveTemplate()],
    assignments: [],
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isGrooveTemplateAssignment(value: unknown): value is GrooveTemplateAssignment {
    return (
        isRecord(value) &&
        Object.keys(value).every((key) => ['consumerType', 'consumerId', 'templateId', 'amount'].includes(key)) &&
        Object.keys(value).length === 4 &&
        GROOVE_CONSUMER_TYPES.includes(value.consumerType as GrooveConsumerType) &&
        typeof value.consumerId === 'string' &&
        value.consumerId.length > 0 &&
        typeof value.templateId === 'string' &&
        value.templateId.length > 0 &&
        typeof value.amount === 'number' &&
        Number.isFinite(value.amount)
    );
}

export function sanitizeGrooveTemplateState(value: unknown): GrooveTemplateState {
    const rawTemplates = isRecord(value) && Array.isArray(value.templates) ? value.templates : [];
    const templates: GrooveTemplate[] = [createStraightGrooveTemplate()];
    const ids = new Set<string>([STRAIGHT_GROOVE_TEMPLATE_ID]);
    for (const template of rawTemplates) {
        if (!isGrooveTemplate(template) || ids.has(template.id)) {
            continue;
        }
        ids.add(template.id);
        templates.push({
            ...structuredClone(template),
            name: resolveGrooveTemplateNameCollision({ requestedName: template.name, templates }),
        });
    }

    const rawAssignments = isRecord(value) && Array.isArray(value.assignments) ? value.assignments : [];
    const assignmentsByConsumer = new Map<string, GrooveTemplateAssignment>();
    for (const assignment of rawAssignments) {
        if (!isGrooveTemplateAssignment(assignment)) {
            continue;
        }
        const key = `${assignment.consumerType}:${assignment.consumerId}`;
        assignmentsByConsumer.set(key, {
            ...assignment,
            templateId: ids.has(assignment.templateId) ? assignment.templateId : STRAIGHT_GROOVE_TEMPLATE_ID,
            amount: normalizeGrooveAmount(assignment.amount),
        });
    }

    return { templates, assignments: [...assignmentsByConsumer.values()] };
}

export const grooveTemplateStore = createStore<GrooveTemplateState>({
    storage: createAutomergeStorage(DOC_PREFIX_ROOT, 'grooveTemplates'),
    initialData: defaultGrooveTemplateState,
    sanitize: sanitizeGrooveTemplateState,
});
