import { createBuiltinGrooveTemplates } from './BuiltinGrooveTemplates';
import {
    STRAIGHT_GROOVE_TEMPLATE_ID,
    getCanonicalGrooveTemplateKey,
    isGrooveTemplate,
    normalizeGrooveAmount,
    resolveGrooveTemplateIdAlias,
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

export function canonicalizeGrooveConsumerId(consumerId: string): string | null {
    const canonicalId = consumerId.normalize('NFKC').trim();
    return canonicalId.length > 0 ? canonicalId : null;
}

export function isGrooveTemplateAssignment(value: unknown): value is GrooveTemplateAssignment {
    return (
        isRecord(value) &&
        hasExactKeys(value, ['consumerType', 'consumerId', 'templateId', 'amount']) &&
        GROOVE_CONSUMER_TYPES.includes(value.consumerType as GrooveConsumerType) &&
        typeof value.consumerId === 'string' &&
        canonicalizeGrooveConsumerId(value.consumerId) === value.consumerId &&
        typeof value.templateId === 'string' &&
        resolveGrooveTemplateIdAlias(value.templateId) === value.templateId &&
        typeof value.amount === 'number' &&
        Number.isFinite(value.amount) &&
        value.amount >= 0 &&
        value.amount <= 1
    );
}

function isCanonicalBuiltin(template: GrooveTemplate, builtin: GrooveTemplate): boolean {
    return (
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
}

function hasCanonicalBuiltinValues(templates: readonly GrooveTemplate[]): boolean {
    const builtinById = new Map(createBuiltinGrooveTemplates().map((builtin) => [builtin.id, builtin]));
    const straight = templates.find((template) => template.id === STRAIGHT_GROOVE_TEMPLATE_ID);
    const canonicalStraight = builtinById.get(STRAIGHT_GROOVE_TEMPLATE_ID);
    return (
        straight !== undefined &&
        canonicalStraight !== undefined &&
        isCanonicalBuiltin(straight, canonicalStraight) &&
        templates.every((template) => {
            const builtin = builtinById.get(template.id);
            return builtin === undefined || isCanonicalBuiltin(template, builtin);
        })
    );
}

export function isGrooveTemplateState(value: unknown): value is GrooveTemplateState {
    if (
        !isRecord(value) ||
        !hasExactKeys(value, ['templates', 'assignments']) ||
        !Array.isArray(value.templates) ||
        !value.templates.every(isGrooveTemplate) ||
        !Array.isArray(value.assignments) ||
        !value.assignments.every(isGrooveTemplateAssignment)
    ) {
        return false;
    }

    const templates = value.templates;
    const templateIds = templates.map((template) => template.id);
    const templateNames = templates.map((template) => getCanonicalGrooveTemplateKey(template.name));
    const assignmentKeys = value.assignments.map((assignment) => `${assignment.consumerType}:${assignment.consumerId}`);
    const knownTemplateIds = new Set(templateIds);
    return (
        hasCanonicalBuiltinValues(templates) &&
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
    const templateIdMappings = new Map<string, string>(templates.map((template) => [template.id, template.id]));
    templateIdMappings.set('straight', STRAIGHT_GROOVE_TEMPLATE_ID);
    for (const template of rawTemplates) {
        if (!isRecord(template) || typeof template.id !== 'string') {
            continue;
        }
        const canonicalId = resolveGrooveTemplateIdAlias(template.id);
        if (!canonicalId) {
            continue;
        }
        templateIdMappings.set(template.id, canonicalId);
        const canonicalTemplate = { ...structuredClone(template), id: canonicalId };
        if (!isGrooveTemplate(canonicalTemplate) || ids.has(canonicalId)) {
            continue;
        }
        ids.add(canonicalId);
        templates.push({
            ...canonicalTemplate,
            name: resolveGrooveTemplateNameCollision({ requestedName: canonicalTemplate.name, templates }),
        });
    }

    const rawAssignments = isRecord(value) && Array.isArray(value.assignments) ? value.assignments : [];
    const assignmentsByConsumer = new Map<string, GrooveTemplateAssignment>();
    for (const assignment of rawAssignments) {
        if (
            !isRecord(assignment) ||
            typeof assignment.consumerId !== 'string' ||
            typeof assignment.templateId !== 'string' ||
            typeof assignment.amount !== 'number' ||
            !Number.isFinite(assignment.amount)
        ) {
            continue;
        }
        const consumerId = canonicalizeGrooveConsumerId(assignment.consumerId);
        const templateId =
            templateIdMappings.get(assignment.templateId) ?? resolveGrooveTemplateIdAlias(assignment.templateId);
        const canonicalAssignment = {
            ...assignment,
            consumerId: consumerId ?? '',
            templateId: templateId && ids.has(templateId) ? templateId : STRAIGHT_GROOVE_TEMPLATE_ID,
            amount: normalizeGrooveAmount(assignment.amount),
        };
        if (!isGrooveTemplateAssignment(canonicalAssignment)) {
            continue;
        }
        const key = `${canonicalAssignment.consumerType}:${canonicalAssignment.consumerId}`;
        assignmentsByConsumer.set(key, canonicalAssignment);
    }

    return { templates, assignments: [...assignmentsByConsumer.values()] };
}
