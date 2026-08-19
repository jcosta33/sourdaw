import { createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage';

import { PROCESSOR_TYPES } from '../models/ProcessorCatalog';
import { type YeastProcessorInfo, type YeastState } from '../models/YeastState';

// `order` was always additive: it is optional on YeastProcessorEntity, every
// read path (decodeProcessors -> entityOrder) tolerates its absence, and no
// code branches on a schema number. There is therefore no version to bump —
// v1 stored no explicit order and decodeProcessors always sorted entities by
// id, silently discarding any reorder the moment it round-tripped through
// this storage (audit #2039: the Yeast rack's advertised reorder capability
// had no way to survive a hydrate); a document written by an old build keeps
// decoding in id order (entityOrder falls back to +Infinity, and the id
// tiebreak takes over) until a local mutation backfills `order` onto every
// entity via syncProcessorEntities. Bumping the version number here would
// only make every previously shipped build throw on hydrate and on write.
const YEAST_CRDT_SCHEMA_VERSION = 1;

/** Empty Yeast rack — the store's seed value and its projection default. */
export const defaultYeastState: YeastState = {
    processors: [],
    uiLevel: 1,
};

type MutableRecord = Record<string, unknown>;
// `order` is optional on the type because a v1 entity read from an existing
// document has none; every entity this module WRITES sets it.
type YeastProcessorEntity = { deleted: boolean; value: YeastProcessorInfo; order?: number };
type YeastCrdtState = {
    schemaVersion: number;
    processors: Record<string, YeastProcessorEntity>;
};

function isRecord(value: unknown): value is MutableRecord {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
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

function normalizeProcessor(value: unknown): YeastProcessorInfo | null {
    if (
        !isRecord(value) ||
        typeof value.id !== 'string' ||
        typeof value.type !== 'string' ||
        typeof value.name !== 'string' ||
        typeof value.bypassed !== 'boolean'
    ) {
        return null;
    }
    const id = value.id.normalize('NFKC').trim();
    const type = PROCESSOR_TYPES.find((candidate) => candidate.type === value.type)?.type;
    if (!id || !type || value.name.trim().length === 0) {
        return null;
    }
    const processor: YeastProcessorInfo = {
        id,
        type,
        name: value.name,
        bypassed: value.bypassed,
    };
    if (isRecord(value.params)) {
        const params = Object.fromEntries(
            Object.entries(value.params).filter(
                (entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1])
            )
        );
        if (Object.keys(params).length > 0) {
            processor.params = params;
        }
    }
    return processor;
}

/**
 * Validate and de-duplicate, keeping each id's LAST occurrence but its FIRST
 * position — a `Map` never moves an existing key on re-`set`. Order here is
 * "whatever order the caller supplied it in", not a canonical one: callers
 * that need a specific order (a fresh encode, a decode from stored `order`
 * fields) impose it themselves. Resorting here unconditionally is what
 * silently discarded every reorder before this module tracked `order`.
 */
function normalizeProcessors(values: unknown): YeastProcessorInfo[] {
    if (!Array.isArray(values)) {
        return [];
    }
    const processorsById = new Map<string, YeastProcessorInfo>();
    for (const value of values) {
        const processor = normalizeProcessor(value);
        if (processor) {
            processorsById.set(processor.id, processor);
        }
    }
    return [...processorsById.values()];
}

function encodeState(processors: readonly YeastProcessorInfo[]): YeastCrdtState {
    return {
        schemaVersion: YEAST_CRDT_SCHEMA_VERSION,
        processors: Object.fromEntries(
            normalizeProcessors(processors).map((processor, index) => [
                processor.id,
                { deleted: false, order: index, value: structuredClone(processor) },
            ])
        ),
    };
}

function isLegacyState(value: unknown): value is { processors: unknown[] } {
    return isRecord(value) && Array.isArray(value.processors) && !Object.hasOwn(value, 'schemaVersion');
}

function isCrdtState(value: unknown): value is YeastCrdtState {
    return (
        isRecord(value) &&
        typeof value.schemaVersion === 'number' &&
        value.schemaVersion === YEAST_CRDT_SCHEMA_VERSION &&
        isRecord(value.processors)
    );
}

function assertSupportedSchema(value: unknown): void {
    if (!isRecord(value) || !Object.hasOwn(value, 'schemaVersion')) {
        return;
    }
    if (typeof value.schemaVersion !== 'number' || value.schemaVersion !== YEAST_CRDT_SCHEMA_VERSION) {
        throw new Error(`Unsupported Yeast CRDT schema version: ${String(value.schemaVersion)}`);
    }
}

/** An entity's `order`, or +Infinity for a v1 entity that never had one — sorted to the end, then by id. */
function entityOrder(entity: YeastProcessorEntity): number {
    return typeof entity.order === 'number' ? entity.order : Number.POSITIVE_INFINITY;
}

/**
 * Total order: two order-less entities both fall back to +Infinity, and
 * `Infinity - Infinity` is `NaN` — a delta-based comparator returns NaN for
 * that pair, which ECMA-262 SortCompare coerces to +0, so every order-less
 * pair would compare equal and the stable sort would fall through to
 * Automerge's internal map key order (add order) instead of ever reaching
 * the id tiebreak below. Comparing with explicit `<`/`>` first makes
 * `Infinity === Infinity` take the id branch instead.
 */
function compareEntities(left: [string, YeastProcessorEntity], right: [string, YeastProcessorEntity]): number {
    const leftOrder = entityOrder(left[1]);
    const rightOrder = entityOrder(right[1]);
    if (leftOrder < rightOrder) {
        return -1;
    }
    if (leftOrder > rightOrder) {
        return 1;
    }
    return compareEntityKeys(left[0], right[0]);
}

function decodeProcessors(value: unknown): YeastProcessorInfo[] {
    assertSupportedSchema(value);
    if (!isCrdtState(value)) {
        return isRecord(value) ? normalizeProcessors(value.processors) : [];
    }
    const live = Object.entries(value.processors).filter(
        (entry): entry is [string, YeastProcessorEntity] => isRecord(entry[1]) && entry[1].deleted === false
    );
    live.sort(compareEntities);
    return normalizeProcessors(live.map(([, entity]) => entity.value));
}

function encodeMigratedState(previous: unknown, processors: readonly YeastProcessorInfo[]): YeastCrdtState {
    const encoded = encodeState(processors);
    if (!isLegacyState(previous)) {
        return encoded;
    }
    const desiredIds = new Set(processors.map((processor) => processor.id));
    for (const processor of normalizeProcessors(previous.processors)) {
        if (!desiredIds.has(processor.id)) {
            encoded.processors[processor.id] = { deleted: true, value: structuredClone(processor) };
        }
    }
    return encoded;
}

function mergeEntityRecords(
    target: Record<string, YeastProcessorEntity>,
    source: Record<string, YeastProcessorEntity>
): void {
    for (const key of Object.keys(source).sort(compareEntityKeys)) {
        const incoming = source[key]!;
        const existing = target[key];
        if (existing?.deleted === true) {
            continue;
        }
        if (!existing || incoming.deleted === true) {
            target[key] = structuredClone(incoming);
        }
    }
}

function reconcileRootConflicts(values: readonly unknown[]): YeastCrdtState {
    const merged: YeastCrdtState = { schemaVersion: YEAST_CRDT_SCHEMA_VERSION, processors: {} };
    for (const value of values) {
        assertSupportedSchema(value);
        const state = isCrdtState(value) ? value : encodeState(decodeProcessors(value));
        mergeEntityRecords(merged.processors, state.processors);
    }
    return merged;
}

function replaceIfChanged(target: MutableRecord, key: string, value: unknown): void {
    if (JSON.stringify(target[key]) !== JSON.stringify(value)) {
        target[key] = value;
    }
}

function syncProcessorValue(target: MutableRecord, processor: YeastProcessorInfo): void {
    replaceIfChanged(target, 'id', processor.id);
    replaceIfChanged(target, 'type', processor.type);
    replaceIfChanged(target, 'name', processor.name);
    replaceIfChanged(target, 'bypassed', processor.bypassed);
    if (processor.params) {
        replaceIfChanged(target, 'params', processor.params);
    } else if (Object.hasOwn(target, 'params')) {
        delete target.params;
    }
}

function syncProcessorEntities(current: MutableRecord, desiredProcessors: readonly YeastProcessorInfo[]): void {
    // `desired`'s iteration order IS the target order — normalizeProcessors no
    // longer imposes one of its own, so this is exactly desiredProcessors'
    // order, deduplicated.
    const desired = new Map(normalizeProcessors(desiredProcessors).map((processor) => [processor.id, processor]));
    for (const [id, entity] of Object.entries(current)) {
        if (!desired.has(id) && isRecord(entity) && entity.deleted !== true) {
            entity.deleted = true;
        }
    }
    let index = 0;
    for (const [id, processor] of desired) {
        const entity = current[id];
        if (!isRecord(entity) || !isRecord(entity.value)) {
            current[id] = { deleted: false, order: index, value: processor };
            index += 1;
            continue;
        }
        if (entity.deleted !== false) {
            entity.deleted = false;
        }
        // Every commit re-asserts order from the current desired position —
        // this is what actually makes a reorder (or a v1 entity that never
        // had one) converge, not just a brand-new entity.
        replaceIfChanged(entity, 'order', index);
        syncProcessorValue(entity.value, processor);
        index += 1;
    }
}

function mutateYeastCrdt({ doc, key, value }: { doc: MutableRecord; key: string; value: YeastState }): void {
    const current = doc[key];
    assertSupportedSchema(current);
    if (!isCrdtState(current)) {
        doc[key] = encodeMigratedState(current, value.processors);
        return;
    }
    // Backfills `order` onto every entity, including one that never had it,
    // the first time it is locally mutated — no schema bump needed, `order`
    // is additive and every read path already tolerates its absence.
    syncProcessorEntities(current.processors, value.processors);
}

function rebaseProcessors({
    base,
    pending,
    hydrated,
}: {
    base: readonly YeastProcessorInfo[];
    pending: readonly YeastProcessorInfo[];
    hydrated: readonly YeastProcessorInfo[];
}): YeastProcessorInfo[] {
    const baseById = new Map(base.map((processor) => [processor.id, processor]));
    const pendingById = new Map(pending.map((processor) => [processor.id, processor]));
    const rebasedById = new Map(hydrated.map((processor) => [processor.id, processor]));
    for (const id of new Set([...baseById.keys(), ...pendingById.keys()])) {
        const baseProcessor = baseById.get(id);
        const pendingProcessor = pendingById.get(id);
        if (JSON.stringify(baseProcessor) === JSON.stringify(pendingProcessor)) {
            continue;
        }
        if (pendingProcessor) {
            rebasedById.set(id, pendingProcessor);
        } else {
            rebasedById.delete(id);
        }
    }
    // `rebasedById` is seeded from `hydrated`, so it already carries the
    // correct order (decodeProcessors now returns processors in persisted
    // `order`, not id order) — `Map.set` on an existing key does not move it,
    // so an edited-in-place entry keeps its hydrated position and only a
    // newly pending-added entry lands at the end. Re-sorting by id here would
    // undo that and is what silently discarded order before this module
    // tracked it explicitly.
    return [...rebasedById.values()];
}

function rebasePendingYeastState({
    baseValue,
    pendingValue,
    hydratedValue,
}: {
    baseValue: YeastState | null;
    pendingValue: YeastState | null;
    hydratedValue: YeastState;
}): YeastState | null {
    if (!pendingValue) {
        return null;
    }
    return {
        ...pendingValue,
        processors: rebaseProcessors({
            base: baseValue?.processors ?? [],
            pending: pendingValue.processors,
            hydrated: hydratedValue.processors,
        }),
    };
}

export function createYeastAutomergeStorage(getLocalState: () => YeastState | null) {
    let reconciledConflictState: YeastCrdtState | null = null;
    function decode(value: unknown): YeastState {
        const local = getLocalState();
        const state: YeastState = {
            processors: decodeProcessors(value),
            uiLevel: local?.uiLevel ?? 1,
        };
        if (local?.runtimeStatus) {
            state.runtimeStatus = local.runtimeStatus;
        }
        if (local?.runtimeError) {
            state.runtimeError = local.runtimeError;
        }
        return state;
    }

    return createAutomergeStorage<YeastState>('root', 'yeast', {
        fromCrdt: (value) => {
            reconciledConflictState = null;
            return decode(value);
        },
        // Audit CC-2 — projection default for a document without this slot, so
        // hydrate never writes the previous project's cache back into truth.
        hydrateMissing: () => {
            reconciledConflictState = null;
            return defaultYeastState;
        },
        resolveCrdtConflicts: (values) => {
            reconciledConflictState = reconcileRootConflicts(values);
            return decode(reconciledConflictState);
        },
        mutateCrdt: (input) => {
            if (reconciledConflictState) {
                const collapseState = structuredClone(reconciledConflictState);
                syncProcessorEntities(collapseState.processors, input.value.processors);
                input.doc[input.key] = collapseState;
                reconciledConflictState = null;
                return;
            }
            mutateYeastCrdt(input);
        },
        rebasePending: rebasePendingYeastState,
    });
}
