import { createBuiltinGrooveTemplates } from './BuiltinGrooveTemplates';
import {
    STRAIGHT_GROOVE_TEMPLATE_ID,
    getCanonicalGrooveTemplateKey,
    isGrooveTemplate,
    normalizeGrooveAmount,
    resolveGrooveTemplateNameCollision,
    type GrooveTemplate,
} from './GrooveTemplate';

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
    templates: createBuiltinGrooveTemplates(),
    assignments: [],
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
    const allowed = new Set(keys);
    return Object.keys(value).every((key) => allowed.has(key)) && keys.every((key) => Object.hasOwn(value, key));
}

function isGrooveTemplateAssignment(value: unknown): value is GrooveTemplateAssignment {
    return (
        isRecord(value) &&
        hasExactKeys(value, ['consumerType', 'consumerId', 'templateId', 'amount']) &&
        GROOVE_CONSUMER_TYPES.includes(value.consumerType as GrooveConsumerType) &&
        typeof value.consumerId === 'string' &&
        value.consumerId.trim().length > 0 &&
        typeof value.templateId === 'string' &&
        value.templateId.length > 0 &&
        typeof value.amount === 'number' &&
        Number.isFinite(value.amount)
    );
}

function hasCanonicalBuiltins(templates: readonly GrooveTemplate[]): boolean {
    return createBuiltinGrooveTemplates().every((builtin) => {
        const template = templates.find((candidate) => candidate.id === builtin.id);
        return (
            template !== undefined &&
            template.name === builtin.name &&
            template.subdivision === builtin.subdivision &&
            template.provenance.type === 'builtin' &&
            template.provenance.sourceId === builtin.provenance.sourceId &&
            template.slots.length === builtin.slots.length &&
            template.slots.every((slot, index) => {
                const builtinSlot = builtin.slots[index];
                return (
                    builtinSlot !== undefined &&
                    slot.index === builtinSlot.index &&
                    slot.timingOffset === builtinSlot.timingOffset &&
                    slot.dynamicsOffset === builtinSlot.dynamicsOffset
                );
            })
        );
    });
}

export function isGrooveTemplateState(value: unknown): value is GrooveTemplateState {
    if (
        !isRecord(value) ||
        !hasExactKeys(value, ['templates', 'assignments']) ||
        !Array.isArray(value.templates) ||
        !value.templates.every(isGrooveTemplate) ||
        !Array.isArray(value.assignments) ||
        !value.assignments.every(isGrooveTemplateAssignment) ||
        value.assignments.some((assignment) => assignment.amount < 0 || assignment.amount > 1)
    ) {
        return false;
    }

    const templates = value.templates;
    const templateIds = templates.map((template) => template.id);
    const templateNames = templates.map((template) => getCanonicalGrooveTemplateKey(template.name));
    const assignmentKeys = value.assignments.map((assignment) => `${assignment.consumerType}:${assignment.consumerId}`);
    const knownTemplateIds = new Set(templateIds);
    return (
        hasCanonicalBuiltins(templates) &&
        new Set(templateIds).size === templateIds.length &&
        new Set(templateNames).size === templateNames.length &&
        new Set(assignmentKeys).size === assignmentKeys.length &&
        value.assignments.every((assignment) => knownTemplateIds.has(assignment.templateId))
    );
}

export function sanitizeGrooveTemplateState(value: unknown): GrooveTemplateState {
    const rawTemplates = isRecord(value) && Array.isArray(value.templates) ? value.templates : [];
    const templates = createBuiltinGrooveTemplates();
    const ids = new Set<string>(templates.map((template) => template.id));
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

export function reconcileGrooveTemplateStateConflicts(states: readonly GrooveTemplateState[]): GrooveTemplateState {
    return sanitizeGrooveTemplateState({
        templates: states.flatMap((state) => state.templates),
        assignments: states.flatMap((state) => state.assignments),
    });
}
