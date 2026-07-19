import { createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage';

import { type GrooveTemplate } from '../models/GrooveTemplate';
import {
    sanitizeGrooveTemplateState,
    type GrooveTemplateAssignment,
    type GrooveTemplateState,
} from '../models/GrooveTemplateState';

const DOC_PREFIX_ROOT = 'root';
const GROOVE_CRDT_SCHEMA_VERSION = 1;

type MutableRecord = Record<string, unknown>;
type GrooveTemplateEntity = { deleted: boolean; value: GrooveTemplate };
type GrooveAssignmentEntity = { deleted: boolean; value: GrooveTemplateAssignment };
type GrooveTemplateCrdtState = {
    schemaVersion: number;
    templates: Record<string, GrooveTemplateEntity>;
    assignments: Record<string, GrooveAssignmentEntity>;
};

function isRecord(value: unknown): value is MutableRecord {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assignmentEntityKey(assignment: Pick<GrooveTemplateAssignment, 'consumerType' | 'consumerId'>): string {
    return JSON.stringify([assignment.consumerType, assignment.consumerId]);
}

function encodeState(state: GrooveTemplateState): GrooveTemplateCrdtState {
    return {
        schemaVersion: GROOVE_CRDT_SCHEMA_VERSION,
        templates: Object.fromEntries(
            state.templates.map((template) => [template.id, { deleted: false, value: structuredClone(template) }])
        ),
        assignments: Object.fromEntries(
            state.assignments.map((assignment) => [
                assignmentEntityKey(assignment),
                { deleted: false, value: structuredClone(assignment) },
            ])
        ),
    };
}

function isCrdtState(value: unknown): value is GrooveTemplateCrdtState {
    return (
        isRecord(value) &&
        value.schemaVersion === GROOVE_CRDT_SCHEMA_VERSION &&
        isRecord(value.templates) &&
        isRecord(value.assignments)
    );
}

function compareEntityKeys(left: string, right: string): number {
    if (left < right) {
        return -1;
    }
    if (left > right) {
        return 1;
    }
    return 0;
}

function decodeState(value: unknown): GrooveTemplateState {
    if (!isCrdtState(value)) {
        return sanitizeGrooveTemplateState(value);
    }
    const templates = Object.entries(value.templates)
        .sort(([left], [right]) => compareEntityKeys(left, right))
        .flatMap(([, entity]) => (isRecord(entity) && entity.deleted === false ? [entity.value] : []));
    const assignments = Object.entries(value.assignments)
        .sort(([left], [right]) => compareEntityKeys(left, right))
        .flatMap(([, entity]) => (isRecord(entity) && entity.deleted === false ? [entity.value] : []));
    return sanitizeGrooveTemplateState({ templates, assignments });
}

function reconcileRootConflicts(values: readonly GrooveTemplateState[]): GrooveTemplateState {
    const templatesById = new Map<string, GrooveTemplate>();
    const assignmentsByConsumer = new Map<string, GrooveTemplateAssignment>();
    for (const state of values) {
        for (const template of state.templates) {
            if (!templatesById.has(template.id)) {
                templatesById.set(template.id, template);
            }
        }
        for (const assignment of state.assignments) {
            const key = assignmentEntityKey(assignment);
            if (!assignmentsByConsumer.has(key)) {
                assignmentsByConsumer.set(key, assignment);
            }
        }
    }
    return sanitizeGrooveTemplateState({
        templates: [...templatesById.values()],
        assignments: [...assignmentsByConsumer.values()],
    });
}

function replaceIfChanged(target: MutableRecord, key: string, value: unknown): void {
    if (JSON.stringify(target[key]) !== JSON.stringify(value)) {
        target[key] = value;
    }
}

function syncTemplateValue(target: MutableRecord, template: GrooveTemplate): void {
    replaceIfChanged(target, 'id', template.id);
    replaceIfChanged(target, 'name', template.name);
    replaceIfChanged(target, 'schemaVersion', template.schemaVersion);
    replaceIfChanged(target, 'subdivision', template.subdivision);
    replaceIfChanged(target, 'slots', template.slots);
    replaceIfChanged(target, 'provenance', template.provenance);
}

function syncAssignmentValue(target: MutableRecord, assignment: GrooveTemplateAssignment): void {
    replaceIfChanged(target, 'consumerType', assignment.consumerType);
    replaceIfChanged(target, 'consumerId', assignment.consumerId);
    replaceIfChanged(target, 'templateId', assignment.templateId);
    replaceIfChanged(target, 'amount', assignment.amount);
}

function syncEntities<Value>({
    current,
    desired,
    syncValue,
}: {
    current: MutableRecord;
    desired: ReadonlyMap<string, Value>;
    syncValue: (target: MutableRecord, value: Value) => void;
}): void {
    for (const [key, entity] of Object.entries(current)) {
        if (!desired.has(key) && isRecord(entity) && entity.deleted !== true) {
            entity.deleted = true;
        }
    }
    for (const [key, value] of desired) {
        const entity = current[key];
        if (!isRecord(entity) || !isRecord(entity.value)) {
            current[key] = { deleted: false, value };
            continue;
        }
        if (entity.deleted !== false) {
            entity.deleted = false;
        }
        syncValue(entity.value, value);
    }
}

function mutateGrooveTemplateCrdt({
    doc,
    key,
    value,
}: {
    doc: MutableRecord;
    key: string;
    value: GrooveTemplateState;
}): void {
    const canonicalState = sanitizeGrooveTemplateState(value);
    const current = doc[key];
    if (!isCrdtState(current)) {
        doc[key] = encodeState(canonicalState);
        return;
    }
    const desiredTemplates = new Map(canonicalState.templates.map((template) => [template.id, template]));
    const desiredAssignments = new Map(
        canonicalState.assignments.map((assignment) => [assignmentEntityKey(assignment), assignment])
    );
    syncEntities({ current: current.templates, desired: desiredTemplates, syncValue: syncTemplateValue });
    syncEntities({ current: current.assignments, desired: desiredAssignments, syncValue: syncAssignmentValue });
}

function rebaseEntities<Value>({
    base,
    pending,
    hydrated,
    getKey,
}: {
    base: readonly Value[];
    pending: readonly Value[];
    hydrated: readonly Value[];
    getKey: (value: Value) => string;
}): Value[] {
    const baseByKey = new Map(base.map((value) => [getKey(value), value]));
    const pendingByKey = new Map(pending.map((value) => [getKey(value), value]));
    const rebasedByKey = new Map(hydrated.map((value) => [getKey(value), value]));
    const localKeys = new Set([...baseByKey.keys(), ...pendingByKey.keys()]);
    for (const key of localKeys) {
        const baseValue = baseByKey.get(key);
        const pendingValue = pendingByKey.get(key);
        if (JSON.stringify(baseValue) === JSON.stringify(pendingValue)) {
            continue;
        }
        if (pendingValue === undefined) {
            rebasedByKey.delete(key);
        } else {
            rebasedByKey.set(key, pendingValue);
        }
    }
    return [...rebasedByKey.values()];
}

function rebasePendingGrooveState({
    baseValue,
    pendingValue,
    hydratedValue,
}: {
    baseValue: GrooveTemplateState | null;
    pendingValue: GrooveTemplateState | null;
    hydratedValue: GrooveTemplateState;
}): GrooveTemplateState | null {
    if (!pendingValue) {
        return null;
    }
    const base = sanitizeGrooveTemplateState(baseValue);
    const pending = sanitizeGrooveTemplateState(pendingValue);
    const hydrated = sanitizeGrooveTemplateState(hydratedValue);
    return sanitizeGrooveTemplateState({
        templates: rebaseEntities({
            base: base.templates,
            pending: pending.templates,
            hydrated: hydrated.templates,
            getKey: (template) => template.id,
        }),
        assignments: rebaseEntities({
            base: base.assignments,
            pending: pending.assignments,
            hydrated: hydrated.assignments,
            getKey: assignmentEntityKey,
        }),
    });
}

export function createGrooveTemplateAutomergeStorage() {
    let shouldCollapseRootConflicts = false;
    return createAutomergeStorage<GrooveTemplateState>(DOC_PREFIX_ROOT, 'grooveTemplates', {
        fromCrdt: (value) => {
            shouldCollapseRootConflicts = false;
            return decodeState(value);
        },
        resolveConflicts: (values) => {
            shouldCollapseRootConflicts = true;
            return reconcileRootConflicts(values);
        },
        mutateCrdt: (input) => {
            if (shouldCollapseRootConflicts) {
                input.doc[input.key] = encodeState(sanitizeGrooveTemplateState(input.value));
                shouldCollapseRootConflicts = false;
                return;
            }
            mutateGrooveTemplateCrdt(input);
        },
        rebasePending: rebasePendingGrooveState,
    });
}
