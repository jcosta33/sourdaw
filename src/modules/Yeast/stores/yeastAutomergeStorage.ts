import { createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage';
import { type StorageAdapter } from '#/infra/store/storage/types';

import { PROCESSOR_TYPES } from '../models/ProcessorCatalog';
import { type YeastProcessorInfo, type YeastState } from '../models/YeastState';

// ── Wire format ───────────────────────────────────────────────────────────────
//
// The `yeast` slot is keyed by device instance: one rack per Yeast device, the
// same one-slot/id-keyed-map shape `gainEnvelopes` (clip id) and `vcaGroups`
// use. Before v2 the slot held a single project-wide rack, so every Yeast
// device shared one rack (issue #2422: adding, reordering, or bypassing on one
// track did the same to every other track's Yeast).
//
// Slot schema history:
// - pre-v1: `{ processors: YeastProcessorInfo[] }` (array of processors)
// - v1: `{ schemaVersion: 1, processors: Record<processorId, Entity> }`
// - v2 (current): `{ schemaVersion: 2, racks: Record<deviceId, RackCrdtState> }`,
//   where each rack keeps the v1 shape byte-for-byte.
//
// Unlike the additive `order` backfill documented on the rack codec below, the
// v1 → v2 change is NOT additive — a v1 build cannot read a v2 slot — so the
// slot version IS bumped: an older build hitting a v2 slot fails loudly on
// hydrate with `Unsupported Yeast CRDT schema version` rather than silently
// writing a flat rack back over the device-keyed one and destroying every
// other device's rack for every peer. The migration direction is the opposite
// one: THIS build still reads a v1 slot (every project saved before #2422)
// and parks its single rack for the first device to adopt — see
// {@link LEGACY_SHARED_RACK_DEVICE_ID}.
const YEAST_SLOT_SCHEMA_VERSION = 2;
/** Per-rack shape — unchanged from the slot this module shipped as v1. */
const YEAST_RACK_SCHEMA_VERSION = 1;

/**
 * Home for the rack of a legacy single-rack slot until a Yeast device claims
 * it. A v1/pre-v1 slot decodes to this key because decode cannot know device
 * ids; reads and writes adopt it for the FIRST Yeast device (see
 * {@link resolveRackFor}) and a write materializes it under that device's id,
 * so the legacy rack is attached to exactly one instance, never shared.
 */
export const LEGACY_SHARED_RACK_DEVICE_ID = '__legacy_shared_rack__';

/** Empty Yeast rack — the store's seed value and its projection default. */
export const defaultYeastState: YeastState = {
    processors: [],
    uiLevel: 1,
};

type MutableRecord = Record<string, unknown>;
// `order` is optional on the type because a v1 entity read from an existing
// document has none; every entity this module WRITES sets it.
type YeastProcessorEntity = { deleted: boolean; value: YeastProcessorInfo; order?: number };
/** One device's rack — the exact shape the slot carried at slot schema v1. */
type RackCrdtState = {
    schemaVersion: typeof YEAST_RACK_SCHEMA_VERSION;
    processors: Record<string, YeastProcessorEntity>;
};
type YeastSlotCrdtState = {
    schemaVersion: typeof YEAST_SLOT_SCHEMA_VERSION;
    racks: Record<string, RackCrdtState>;
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

function encodeRack(processors: readonly YeastProcessorInfo[]): RackCrdtState {
    return {
        schemaVersion: YEAST_RACK_SCHEMA_VERSION,
        processors: Object.fromEntries(
            normalizeProcessors(processors).map((processor, index) => [
                processor.id,
                { deleted: false, order: index, value: structuredClone(processor) },
            ])
        ),
    };
}

function isRackCrdtState(value: unknown): value is RackCrdtState {
    return isRecord(value) && value.schemaVersion === YEAST_RACK_SCHEMA_VERSION && isRecord(value.processors);
}

/**
 * A v2 slot: `schemaVersion: 2` with a `racks` record. Anything else that
 * carries a `schemaVersion` is refused (see the slot history comment above).
 */
function isSlotCrdtState(value: unknown): value is YeastSlotCrdtState {
    return isRecord(value) && value.schemaVersion === YEAST_SLOT_SCHEMA_VERSION && isRecord(value.racks);
}

/**
 * Slot versions this build reads: v2 (current) and v1 (the project-wide
 * single-rack slot main ships — the migration source, parked by
 * {@link parseSlot}). A versionless record is pre-v1 and also parks. Anything
 * else is a future format this build cannot interpret; failing loudly beats
 * writing a flattened rack back over it.
 */
function isSupportedLegacySlotVersion(version: unknown): boolean {
    return version === YEAST_SLOT_SCHEMA_VERSION || version === 1;
}

function assertSupportedSlotSchema(value: unknown): void {
    if (!isRecord(value) || !Object.hasOwn(value, 'schemaVersion')) {
        return;
    }
    if (!isSupportedLegacySlotVersion(value.schemaVersion)) {
        throw new Error(`Unsupported Yeast CRDT schema version: ${String(value.schemaVersion)}`);
    }
}

function assertSupportedRackSchema(value: unknown): void {
    if (!isRecord(value) || !Object.hasOwn(value, 'schemaVersion')) {
        return;
    }
    if (typeof value.schemaVersion !== 'number' || value.schemaVersion !== YEAST_RACK_SCHEMA_VERSION) {
        throw new Error(`Unsupported Yeast rack CRDT schema version: ${String(value.schemaVersion)}`);
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

/**
 * Decode one rack's live processors. A rack that is not a v1 rack record is
 * read through the legacy lenient path (the pre-v1 processor array), which is
 * also how a parked legacy slot's rack is decoded.
 */
function decodeProcessors(value: unknown): YeastProcessorInfo[] {
    assertSupportedRackSchema(value);
    if (isRackCrdtState(value)) {
        const live = Object.entries(value.processors).filter(
            (entry): entry is [string, YeastProcessorEntity] => isRecord(entry[1]) && entry[1].deleted === false
        );
        live.sort(compareEntities);
        return normalizeProcessors(live.map(([, entity]) => entity.value));
    }
    if (!isRecord(value)) {
        return [];
    }
    if (Array.isArray(value.processors)) {
        return normalizeProcessors(value.processors);
    }
    if (isRecord(value.processors)) {
        const live = Object.entries(value.processors).filter(
            (entry): entry is [string, YeastProcessorEntity] => isRecord(entry[1]) && entry[1].deleted === false
        );
        live.sort(compareEntities);
        return normalizeProcessors(live.map(([, entity]) => entity.value));
    }
    return [];
}

/** Coerce a legacy single-rack slot value into the rack shape it ships forward as. */
function legacySlotToRack(value: unknown): RackCrdtState {
    // Re-encode through the normalizing decoder: entities keep causal
    // identity only for ids that survive validation, and ids the decoder
    // drops were unreadable to every reader anyway.
    return encodeRack(decodeProcessors(value));
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

export type YeastAutomergeStorageInput = {
    /** The owning store's current view — read to carry session-only fields across a decode. */
    getLocalState: () => YeastState | null;
    /** Which device instance the adapter's `YeastState` view reflects. */
    getActiveDeviceId: () => string | null;
    /** First Yeast device id in the project — the owner a legacy shared rack migrates to. */
    resolveFirstYeastDeviceId: () => string | null;
};

export type YeastAutomergeStorageView = {
    storage: StorageAdapter<YeastState>;
    /** Settle only this view's pending unscoped rack edit before its device identity moves. */
    flushPendingRackWrite(): void;
    /**
     * Switch which device's rack the view reflects WITHOUT authoring a write:
     * the new rack is decoded from the slot state this adapter already holds.
     * A device switch never edits shared truth — the next real mutation
     * writes the (identical) rack back under the new device's key.
     */
    setActiveDevice(deviceId: string | null): void;
    /** One device's decoded rack, independent of which device is active. */
    readRack(deviceId: string): YeastState;
    /**
     * Every device id the adapter holds a rack for — document-decoded and
     * locally written alike, including the parked legacy key. The union the
     * whole-project readers (groove-assignment reconcile) iterate; unlike a
     * track-store enumeration it also covers devices that live only in
     * stored arrangements.
     */
    listRackDeviceIds(): string[];
};

export function createYeastAutomergeStorage(input: YeastAutomergeStorageInput): YeastAutomergeStorageView {
    const { getLocalState, getActiveDeviceId, resolveFirstYeastDeviceId } = input;
    /** Rack states decoded from the last observed slot value, keyed by device id. */
    let decodedRacks = new Map<string, RackCrdtState>();
    /** Slot-level state collapsed from concurrent conflicts, until the next write. */
    let reconciledSlotState: YeastSlotCrdtState | null = null;

    /**
     * MIGRATION RULE (issue #2422): a legacy single-rack slot belongs to the
     * FIRST Yeast device instance. Decode parks it under the reserved legacy
     * key; a device with no rack of its own reads the parked rack only while
     * it is the first instance, and the first write through that device
     * materializes the rack under its id (removing the parked copy), so the
     * legacy rack opens attached to exactly one device — never shared, never
     * silently dropped.
     */
    function resolveRackFor(deviceId: string | null): RackCrdtState | undefined {
        if (deviceId === null) {
            return undefined;
        }
        const own = decodedRacks.get(deviceId);
        if (own) {
            return own;
        }
        if (deviceId === resolveFirstYeastDeviceId()) {
            return decodedRacks.get(LEGACY_SHARED_RACK_DEVICE_ID);
        }
        return undefined;
    }

    function buildViewState(rack: RackCrdtState | undefined): YeastState {
        const local = getLocalState();
        const state: YeastState = {
            processors: rack ? decodeProcessors(rack) : [],
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

    function decodeActiveRack(): YeastState {
        return buildViewState(resolveRackFor(getActiveDeviceId()));
    }

    /** Device whose rack the view last projected; `undefined` = never projected. */
    let projectedDeviceId: string | null | undefined;

    /** Parse a slot value into per-device rack states, parking any legacy single rack. */
    function parseSlot(value: unknown): Map<string, RackCrdtState> {
        assertSupportedSlotSchema(value);
        const racks = new Map<string, RackCrdtState>();
        if (isSlotCrdtState(value)) {
            for (const [deviceId, rack] of Object.entries(value.racks)) {
                if (!isRecord(rack)) {
                    continue;
                }
                assertSupportedRackSchema(rack);
                racks.set(deviceId, isRackCrdtState(rack) ? rack : legacySlotToRack(rack));
            }
            return racks;
        }
        if (isRecord(value) && (isRecord(value.processors) || Array.isArray(value.processors))) {
            racks.set(LEGACY_SHARED_RACK_DEVICE_ID, legacySlotToRack(value));
        }
        return racks;
    }

    /**
     * Deterministically reconcile concurrent whole-slot values: each device's
     * rack merges independently with the per-rack entity merge (a legacy
     * concurrent slot merges as the parked rack, so the first device still
     * adopts it after the conflict resolves).
     */
    function reconcileSlotConflicts(values: readonly unknown[]): YeastSlotCrdtState {
        const merged = new Map<string, RackCrdtState>();
        for (const value of values) {
            for (const [deviceId, rack] of parseSlot(value)) {
                const existing = merged.get(deviceId);
                if (!existing) {
                    merged.set(deviceId, structuredClone(rack));
                    continue;
                }
                const combined: RackCrdtState = { schemaVersion: YEAST_RACK_SCHEMA_VERSION, processors: {} };
                mergeEntityRecords(combined.processors, existing.processors);
                mergeEntityRecords(combined.processors, rack.processors);
                merged.set(deviceId, combined);
            }
        }
        return { schemaVersion: YEAST_SLOT_SCHEMA_VERSION, racks: Object.fromEntries(merged) };
    }

    /**
     * Write the active device's rack into the slot.
     *
     * A v2 slot is mutated IN PLACE so entities keep causal identity across
     * writes; a legacy slot (v1 flat rack or pre-v1 array) is restructured to
     * v2 once, parking the shared rack for the first device to adopt. With no
     * active device (no Yeast instance) the write is a no-op on the document —
     * the value stays session-visible but nothing owns it in shared truth.
     */
    function mutateSlot({ doc, key, value }: { doc: MutableRecord; key: string; value: YeastState }): void {
        const activeDeviceId = projectedDeviceId === undefined ? getActiveDeviceId() : projectedDeviceId;
        if (activeDeviceId === null) {
            return;
        }
        const current = doc[key];
        assertSupportedSlotSchema(current);

        let slot: YeastSlotCrdtState;
        let isMutableInPlace = false;
        if (reconciledSlotState) {
            slot = structuredClone(reconciledSlotState);
            reconciledSlotState = null;
        } else if (isSlotCrdtState(current)) {
            slot = current;
            isMutableInPlace = true;
        } else {
            slot = { schemaVersion: YEAST_SLOT_SCHEMA_VERSION, racks: {} };
            if (isRecord(current) && (isRecord(current.processors) || Array.isArray(current.processors))) {
                slot.racks[LEGACY_SHARED_RACK_DEVICE_ID] = legacySlotToRack(current);
            }
        }

        // An Automerge draft clones a value AT ASSIGNMENT TIME. A rack that
        // already lives in the draft is read back as the draft's own object,
        // so syncing entities through it mutates document state; a rack built
        // locally must instead be completed BEFORE it is attached — mutating
        // it afterwards would write nothing to the document.
        let adoptedParkedRack = false;
        const existingRack = isRackCrdtState(slot.racks[activeDeviceId]) ? slot.racks[activeDeviceId] : undefined;
        if (existingRack) {
            if (!isRecord(existingRack.processors)) {
                existingRack.processors = {};
            }
            // Backfills `order` onto every entity, including one that never
            // had it, the first time it is locally mutated — no rack schema
            // bump needed, `order` is additive and every read path tolerates
            // its absence.
            syncProcessorEntities(existingRack.processors, value.processors);
        } else {
            const parked = slot.racks[LEGACY_SHARED_RACK_DEVICE_ID];
            if (isRackCrdtState(parked) && activeDeviceId === resolveFirstYeastDeviceId()) {
                // Adopt the legacy shared rack: it becomes this (first)
                // device's rack and the parked copy is removed, so no second
                // device can ever read it. The parked value is re-encoded to
                // PLAIN data before attaching — an Automerge draft cannot
                // reference an object that already lives in the document, and
                // re-encoding is also what keeps the attachment
                // completed-before-attach (see the comment above).
                slot.racks[activeDeviceId] = legacySlotToRack(parked);
                delete slot.racks[LEGACY_SHARED_RACK_DEVICE_ID];
                const adopted = slot.racks[activeDeviceId];
                if (isRackCrdtState(adopted)) {
                    syncProcessorEntities(adopted.processors, value.processors);
                }
                adoptedParkedRack = true;
            } else {
                const fresh: RackCrdtState = { schemaVersion: YEAST_RACK_SCHEMA_VERSION, processors: {} };
                syncProcessorEntities(fresh.processors, value.processors);
                slot.racks[activeDeviceId] = fresh;
            }
        }
        if (!isMutableInPlace) {
            doc[key] = slot;
        }
        // Refresh the decode mirror from what this write just authored: the
        // slot's own projection does NOT re-run after a local-store write
        // (audit CC-1), so `fromCrdt` will not fire again until the next
        // document-origin change — without this, `readRack` and the next
        // `setActiveDevice` projection would serve the rack as of the last
        // hydrate, dropping every edit since. Other devices' racks cannot
        // have changed under this write (it touches only the active key), so
        // keeping their mirror entries is exact.
        decodedRacks = new Map(decodedRacks);
        decodedRacks.set(activeDeviceId, encodeRack(value.processors));
        if (adoptedParkedRack) {
            decodedRacks.delete(LEGACY_SHARED_RACK_DEVICE_ID);
        }
    }

    const storage = createAutomergeStorage<YeastState>('root', 'yeast', {
        fromCrdt: (value) => {
            decodedRacks = parseSlot(value);
            reconciledSlotState = null;
            projectedDeviceId = getActiveDeviceId();
            return decodeActiveRack();
        },
        // Audit CC-2 — projection default for a document without this slot, so
        // hydrate never writes the previous project's cache back into truth.
        hydrateMissing: () => {
            decodedRacks = new Map();
            reconciledSlotState = null;
            projectedDeviceId = getActiveDeviceId();
            return buildViewState(undefined);
        },
        resolveCrdtConflicts: (values) => {
            const merged = reconcileSlotConflicts(values);
            decodedRacks = new Map(Object.entries(merged.racks));
            reconciledSlotState = merged;
            projectedDeviceId = getActiveDeviceId();
            return decodeActiveRack();
        },
        mutateCrdt: (mutation) => {
            mutateSlot(mutation);
        },
        rebasePending: rebasePendingYeastState,
    });

    return {
        storage,
        flushPendingRackWrite: () => {
            storage.flushPendingUnscopedWrite();
        },
        setActiveDevice: (deviceId) => {
            // No-op unless the resolved device changed: this fires on every
            // track-store notification, and re-projecting an unchanged device
            // would overwrite a still-pending rack edit with the (older)
            // decoded rack — the storage layer's `setProjected` replaces the
            // visible pending's value (its sanitizer contract), silently
            // reverting the edit.
            if (deviceId === projectedDeviceId) {
                return;
            }
            projectedDeviceId = deviceId;
            // `setProjected` replaces the visible value without authoring a
            // write and notifies the store's subscribers when it changed.
            storage.setProjected?.(buildViewState(resolveRackFor(deviceId)));
        },
        readRack: (deviceId) => {
            // The active device's live view — including any write still
            // pending in the store — IS that device's rack; the decoded
            // mirror alone would lag every edit since the last hydrate
            // (audit CC-1 skips this slot's projection on local writes).
            if (deviceId === getActiveDeviceId()) {
                return getLocalState() ?? buildViewState(resolveRackFor(deviceId));
            }
            return buildViewState(resolveRackFor(deviceId));
        },
        listRackDeviceIds: () => [...decodedRacks.keys()],
    };
}
