import { createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage';

import { type GrooveTemplate } from '../models/GrooveTemplate';
import {
    defaultGrooveTemplateState,
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

function isLegacyState(value: unknown): boolean {
    return isRecord(value) && Array.isArray(value.templates) && Array.isArray(value.assignments);
}

function encodeMigratedState(previous: unknown, desired: GrooveTemplateState): GrooveTemplateCrdtState {
    const encoded = encodeState(desired);
    if (!isLegacyState(previous)) {
        return encoded;
    }
    const legacySnapshot = JSON.parse(JSON.stringify(previous)) as unknown;
    const legacy = sanitizeGrooveTemplateState(legacySnapshot);
    const desiredTemplateIds = new Set(desired.templates.map((template) => template.id));
    for (const template of legacy.templates) {
        if (!desiredTemplateIds.has(template.id)) {
            encoded.templates[template.id] = { deleted: true, value: structuredClone(template) };
        }
    }
    const desiredAssignmentKeys = new Set(desired.assignments.map(assignmentEntityKey));
    for (const assignment of legacy.assignments) {
        const key = assignmentEntityKey(assignment);
        if (!desiredAssignmentKeys.has(key)) {
            encoded.assignments[key] = { deleted: true, value: structuredClone(assignment) };
        }
    }
    return encoded;
}

function isCrdtState(value: unknown): value is GrooveTemplateCrdtState {
    return (
        isRecord(value) &&
        value.schemaVersion === GROOVE_CRDT_SCHEMA_VERSION &&
        isRecord(value.templates) &&
        isRecord(value.assignments)
    );
}

function assertSupportedCrdtSchema(value: unknown): void {
    if (!isRecord(value) || !Object.hasOwn(value, 'schemaVersion')) {
        return;
    }
    if (value.schemaVersion !== GROOVE_CRDT_SCHEMA_VERSION) {
        throw new Error(`Unsupported groove CRDT schema version: ${String(value.schemaVersion)}`);
    }
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
    assertSupportedCrdtSchema(value);
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

// Key-sorted serialization so the live-vs-live tiebreak below depends on the
// entity's content alone, never on the property insertion order a peer happened
// to produce.
function canonicalEntityValueJson(value: unknown): string {
    return JSON.stringify(value, (_key, nested: unknown) => {
        if (!isRecord(nested)) {
            return nested;
        }
        return Object.fromEntries(Object.entries(nested).sort(([left], [right]) => compareEntityKeys(left, right)));
    });
}

function mergeEntityRecords<Value>(
    target: Record<string, { deleted: boolean; value: Value }>,
    source: Record<string, { deleted: boolean; value: Value }>
): void {
    for (const key of Object.keys(source).sort(compareEntityKeys)) {
        const incoming = source[key]!;
        const existing = target[key];
        if (existing?.deleted === true) {
            continue;
        }
        if (!existing || incoming.deleted === true) {
            target[key] = structuredClone(incoming);
            continue;
        }
        // Live-vs-live: both peers wrote a different, non-deleted value under the
        // same key. Conflicting roots reach this resolver ordered by Automerge
        // actor id, so leaving the case unhandled made the survivor an actor-id
        // lottery that silently discarded one peer's rename. Tiebreak on the
        // content instead — keep the greater canonical JSON. That total order is
        // commutative and associative, so every replica lands on the same entity
        // no matter which peer it merges first. (Tombstones still outrank live
        // values above, and stay sticky; a real last-writer-wins rule would need
        // a timestamp the GrooveTemplate schema does not carry.)
        const isIncomingGreater =
            compareEntityKeys(canonicalEntityValueJson(incoming.value), canonicalEntityValueJson(existing.value)) > 0;
        if (isIncomingGreater) {
            target[key] = structuredClone(incoming);
        }
    }
}

function reconcileCrdtRootConflicts(values: readonly unknown[]): {
    crdtState: GrooveTemplateCrdtState;
    grooveState: GrooveTemplateState;
} {
    const merged: GrooveTemplateCrdtState = {
        schemaVersion: GROOVE_CRDT_SCHEMA_VERSION,
        templates: {},
        assignments: {},
    };
    for (const value of values) {
        assertSupportedCrdtSchema(value);
        const state = isCrdtState(value) ? value : encodeState(sanitizeGrooveTemplateState(value));
        mergeEntityRecords(merged.templates, state.templates);
        mergeEntityRecords(merged.assignments, state.assignments);
    }
    return { crdtState: merged, grooveState: decodeState(merged) };
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
    assertSupportedCrdtSchema(current);
    if (!isCrdtState(current)) {
        doc[key] = encodeMigratedState(current, canonicalState);
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
    let reconciledConflictState: GrooveTemplateCrdtState | null = null;
    return createAutomergeStorage<GrooveTemplateState>(DOC_PREFIX_ROOT, 'grooveTemplates', {
        fromCrdt: (value) => {
            reconciledConflictState = null;
            return decodeState(value);
        },
        // Audit CC-2 — projection default for a document without this slot, so
        // hydrate never writes the previous project's cache back into truth.
        hydrateMissing: () => {
            reconciledConflictState = null;
            return defaultGrooveTemplateState;
        },
        resolveCrdtConflicts: (values) => {
            const reconciliation = reconcileCrdtRootConflicts(values);
            reconciledConflictState = reconciliation.crdtState;
            return reconciliation.grooveState;
        },
        mutateCrdt: (input) => {
            if (reconciledConflictState) {
                const collapseState = structuredClone(reconciledConflictState);
                const desired = sanitizeGrooveTemplateState(input.value);
                syncEntities({
                    current: collapseState.templates,
                    desired: new Map(desired.templates.map((template) => [template.id, template])),
                    syncValue: syncTemplateValue,
                });
                syncEntities({
                    current: collapseState.assignments,
                    desired: new Map(
                        desired.assignments.map((assignment) => [assignmentEntityKey(assignment), assignment])
                    ),
                    syncValue: syncAssignmentValue,
                });
                input.doc[input.key] = collapseState;
                reconciledConflictState = null;
                return;
            }
            mutateGrooveTemplateCrdt(input);
        },
        rebasePending: rebasePendingGrooveState,
    });
}
