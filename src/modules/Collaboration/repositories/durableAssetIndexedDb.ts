const DATABASE_NAME = 'sourdaw-collaboration-original-assets';
const DATABASE_VERSION = 6;
export const ASSET_STORE = 'assets';
export const LEASE_STORE = 'leases';
export const ASSET_OWNER_INDEX = 'by-owner';
export const ASSET_LEASE_OWNER_INDEX = 'by-lease-owner';
export const LEASE_OWNER_INDEX = 'by-owner';
export const OWNER_HANDOFF_STORE = 'ownerHandoffs';
export const OWNER_HANDOFF_TARGET_INDEX = 'by-next-owner';
export const OWNER_AUTHORITY_STORE = 'ownerAuthorities';
export const PROMOTION_RECOVERY_STORE = 'promotionRecoveries';
export const PROMOTION_RECOVERY_OWNER_INDEX = 'by-owner';
export const PROMOTION_RECOVERY_LEASE_INDEX = 'by-lease';
export const RECORD_SCHEMA_VERSION = 2;
export const OWNER_HANDOFF_SCHEMA_VERSION = 1;
const LEGACY_PROMOTION_RECOVERY_SCHEMA_VERSION = 1;
export const PROMOTION_RECOVERY_SCHEMA_VERSION = 2;
export const OWNER_AUTHORITY_SCHEMA_VERSION = 1;
export const DEFAULT_STAGE_RECOVERY_PREFIX = 'asset-stage-default-release:';

export type LeaseState = 'staged' | 'promoted' | 'released';
export type ActiveLease = { leaseId: string; ownerId: string };
export type AssetRecord = {
    schemaVersion: typeof RECORD_SCHEMA_VERSION;
    hash: string;
    blob: Blob;
    name: string;
    ownerIds: string[];
    leaseOwnerIds: string[];
    activeLeases: ActiveLease[];
};
export type LeaseRecord = {
    schemaVersion: typeof RECORD_SCHEMA_VERSION;
    leaseId: string;
    ownerId: string;
    hash: string;
    state: LeaseState;
    terminalAt?: number;
};
export type OwnerHandoffRecord = {
    schemaVersion: typeof OWNER_HANDOFF_SCHEMA_VERSION;
    previousOwnerId: string;
    nextOwnerId: string;
    preparedAt: number;
};
export type OwnerAuthorityRecord = {
    schemaVersion: typeof OWNER_AUTHORITY_SCHEMA_VERSION;
    ownerId: string;
    canonicalOwnerId: string;
    epoch: number;
};
type PromotionRecoveryRecordBase = {
    schemaVersion: typeof PROMOTION_RECOVERY_SCHEMA_VERSION;
    recoveryId: string;
    ownerId: string;
    leaseIds: string[];
    bindings: Array<{ leaseId: string; expectedHash: string }>;
    recoveryKind?: 'default-release' | 'explicit';
    preparedAt: number;
};
type PromotionCommitProof = {
    projectId: string;
    idempotencyKey: string;
    contentHash: string;
    runId: string;
    batchId: string;
    baseRevision: string;
    commands: Array<{ commandId: string; operation: string }>;
};
export type PromotionRecoveryRecord = PromotionRecoveryRecordBase &
    (
        | {
              disposition: 'promote';
              promotionState: 'prepared' | 'committed';
              commitProof?: PromotionCommitProof;
          }
        | {
              disposition: 'release';
              promotionState?: never;
              commitProof?: never;
          }
    );

let databasePromise: Promise<IDBDatabase> | null = null;

function unavailableError(cause?: unknown): Error {
    return new Error('Collaboration asset storage is unavailable', {
        cause: cause ?? new Error('IndexedDB is unavailable'),
    });
}

function migrateVersionOneRecords(assetStore: IDBObjectStore, leaseStore: IDBObjectStore): void {
    const assetCursor = assetStore.openCursor();
    assetCursor.onsuccess = () => {
        const cursor = assetCursor.result;
        if (!cursor) {
            return;
        }
        const rawValue: unknown = cursor.value;
        if (typeof rawValue !== 'object' || rawValue === null) {
            cursor.continue();
            return;
        }
        const value = rawValue as Record<string, unknown>;
        const activeLeases: unknown[] = Array.isArray(value.activeLeases) ? value.activeLeases : [];
        cursor.update({
            ...value,
            schemaVersion: RECORD_SCHEMA_VERSION,
            leaseOwnerIds: [
                ...new Set(
                    activeLeases.flatMap((lease) =>
                        typeof lease === 'object' &&
                        lease !== null &&
                        'ownerId' in lease &&
                        typeof lease.ownerId === 'string'
                            ? [lease.ownerId]
                            : []
                    )
                ),
            ],
        });
        cursor.continue();
    };
    const leaseCursor = leaseStore.openCursor();
    leaseCursor.onsuccess = () => {
        const cursor = leaseCursor.result;
        if (!cursor) {
            return;
        }
        const rawValue: unknown = cursor.value;
        if (typeof rawValue !== 'object' || rawValue === null) {
            cursor.continue();
            return;
        }
        const value = rawValue as Record<string, unknown>;
        cursor.update({
            ...value,
            schemaVersion: RECORD_SCHEMA_VERSION,
            ...(value.state === 'staged' ? {} : { terminalAt: Date.now() }),
        });
        cursor.continue();
    };
}

function migrateLegacyPromotionRecoveryRecords(store: IDBObjectStore): void {
    const request = store.openCursor();
    request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
            return;
        }
        const value: unknown = cursor.value;
        if (!isLegacyPromotionRecoveryRecord(value)) {
            cursor.continue();
            return;
        }
        const {
            commitProof: _legacyCommitProof,
            disposition: _legacyDisposition,
            promotionState: _legacyPromotionState,
            ...record
        } = value;
        if (value.disposition === 'release') {
            cursor.update({
                ...record,
                schemaVersion: PROMOTION_RECOVERY_SCHEMA_VERSION,
                disposition: 'release',
            });
        } else {
            cursor.update({
                ...record,
                schemaVersion: PROMOTION_RECOVERY_SCHEMA_VERSION,
                disposition: 'promote',
                promotionState: value.promotionState === 'committed' ? 'committed' : 'prepared',
            });
        }
        cursor.continue();
    };
}

function ensureIndexes(request: IDBOpenDBRequest, oldVersion: number): void {
    const database = request.result;
    const assetStore = database.objectStoreNames.contains(ASSET_STORE)
        ? request.transaction!.objectStore(ASSET_STORE)
        : database.createObjectStore(ASSET_STORE, { keyPath: 'hash' });
    if (!assetStore.indexNames.contains(ASSET_OWNER_INDEX)) {
        assetStore.createIndex(ASSET_OWNER_INDEX, 'ownerIds', { multiEntry: true });
    }
    if (!assetStore.indexNames.contains(ASSET_LEASE_OWNER_INDEX)) {
        assetStore.createIndex(ASSET_LEASE_OWNER_INDEX, 'leaseOwnerIds', { multiEntry: true });
    }
    const leaseStore = database.objectStoreNames.contains(LEASE_STORE)
        ? request.transaction!.objectStore(LEASE_STORE)
        : database.createObjectStore(LEASE_STORE, { keyPath: 'leaseId' });
    if (!leaseStore.indexNames.contains(LEASE_OWNER_INDEX)) {
        leaseStore.createIndex(LEASE_OWNER_INDEX, 'ownerId');
    }
    const handoffStore = database.objectStoreNames.contains(OWNER_HANDOFF_STORE)
        ? request.transaction!.objectStore(OWNER_HANDOFF_STORE)
        : database.createObjectStore(OWNER_HANDOFF_STORE, { keyPath: 'previousOwnerId' });
    if (!handoffStore.indexNames.contains(OWNER_HANDOFF_TARGET_INDEX)) {
        handoffStore.createIndex(OWNER_HANDOFF_TARGET_INDEX, 'nextOwnerId');
    }
    if (!database.objectStoreNames.contains(OWNER_AUTHORITY_STORE)) {
        database.createObjectStore(OWNER_AUTHORITY_STORE, { keyPath: 'ownerId' });
    }
    const promotionRecoveryStore = database.objectStoreNames.contains(PROMOTION_RECOVERY_STORE)
        ? request.transaction!.objectStore(PROMOTION_RECOVERY_STORE)
        : database.createObjectStore(PROMOTION_RECOVERY_STORE, { keyPath: 'recoveryId' });
    if (!promotionRecoveryStore.indexNames.contains(PROMOTION_RECOVERY_OWNER_INDEX)) {
        promotionRecoveryStore.createIndex(PROMOTION_RECOVERY_OWNER_INDEX, 'ownerId');
    }
    if (!promotionRecoveryStore.indexNames.contains(PROMOTION_RECOVERY_LEASE_INDEX)) {
        promotionRecoveryStore.createIndex(PROMOTION_RECOVERY_LEASE_INDEX, 'leaseIds', { multiEntry: true });
    }
    if (oldVersion === 1) {
        migrateVersionOneRecords(assetStore, leaseStore);
    }
    if (oldVersion < DATABASE_VERSION) {
        migrateLegacyPromotionRecoveryRecords(promotionRecoveryStore);
    }
}

function openDurableAssetDatabase(): Promise<IDBDatabase> {
    if (databasePromise) {
        return databasePromise;
    }
    const promise = new Promise<IDBDatabase>((resolve, reject) => {
        if (typeof globalThis.indexedDB === 'undefined') {
            reject(unavailableError());
            return;
        }
        let request: IDBOpenDBRequest;
        try {
            request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
        } catch (error) {
            reject(unavailableError(error));
            return;
        }
        request.onupgradeneeded = (event) => ensureIndexes(request, event.oldVersion);
        request.onsuccess = () => {
            const database = request.result;
            database.onversionchange = () => {
                database.close();
                if (databasePromise === promise) {
                    databasePromise = null;
                }
            };
            resolve(database);
        };
        request.onerror = () => reject(unavailableError(request.error));
        request.onblocked = () => reject(unavailableError(new Error('IndexedDB upgrade was blocked')));
    });
    databasePromise = promise;
    void promise.catch(() => {
        if (databasePromise === promise) {
            databasePromise = null;
        }
    });
    return promise;
}

function awaitRequest<Result>(request: IDBRequest<Result>): Promise<Result> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
    });
}

function readStoredValue(store: IDBObjectStore, key: string): Promise<unknown> {
    return awaitRequest(store.get(key) as IDBRequest<unknown>);
}

function readIndexedValues(store: IDBObjectStore, indexName: string, key: string): Promise<unknown[]> {
    return awaitRequest(store.index(indexName).getAll(key) as IDBRequest<unknown[]>);
}

function awaitTransaction(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
        transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
    });
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPromotionCommitProof(value: unknown): value is NonNullable<PromotionRecoveryRecord['commitProof']> {
    const fields = [
        'projectId',
        'idempotencyKey',
        'contentHash',
        'runId',
        'batchId',
        'baseRevision',
        'commands',
    ] as const;
    if (
        !isRecord(value) ||
        Object.keys(value).length !== fields.length ||
        !fields.every((field) => Object.hasOwn(value, field)) ||
        !Array.isArray(value.commands) ||
        value.commands.length === 0
    ) {
        return false;
    }
    const commandFields = ['commandId', 'operation'] as const;
    const commandIds = new Set<string>();
    for (const command of value.commands) {
        if (
            !isRecord(command) ||
            Object.keys(command).length !== commandFields.length ||
            !commandFields.every((field) => Object.hasOwn(command, field)) ||
            typeof command.commandId !== 'string' ||
            command.commandId.length === 0 ||
            typeof command.operation !== 'string' ||
            command.operation.length === 0 ||
            commandIds.has(command.commandId)
        ) {
            return false;
        }
        commandIds.add(command.commandId);
    }
    return (
        typeof value.projectId === 'string' &&
        value.projectId.length > 0 &&
        typeof value.idempotencyKey === 'string' &&
        value.idempotencyKey.length > 0 &&
        /^sha256:[a-f0-9]{64}$/.test(String(value.contentHash)) &&
        typeof value.runId === 'string' &&
        value.runId.length > 0 &&
        typeof value.batchId === 'string' &&
        value.batchId.length > 0 &&
        typeof value.baseRevision === 'string' &&
        value.baseRevision.length > 0
    );
}

type LegacyPromotionCommitProof = {
    projectId: string;
    idempotencyKey: string;
    contentHash: string;
    runId: string;
    batchId: string;
};

type LegacyPromotionRecoveryRecord = Omit<PromotionRecoveryRecordBase, 'schemaVersion'> & {
    schemaVersion: typeof LEGACY_PROMOTION_RECOVERY_SCHEMA_VERSION;
    disposition?: 'promote' | 'release';
    promotionState?: 'prepared' | 'committed';
    commitProof?: LegacyPromotionCommitProof;
};

function isLegacyPromotionCommitProof(value: unknown): value is LegacyPromotionCommitProof {
    if (!isRecord(value)) {
        return false;
    }
    const fields = ['projectId', 'idempotencyKey', 'contentHash', 'runId', 'batchId'] as const;
    return (
        Object.keys(value).length === fields.length &&
        fields.every((field) => Object.hasOwn(value, field)) &&
        typeof value.projectId === 'string' &&
        value.projectId.length > 0 &&
        typeof value.idempotencyKey === 'string' &&
        value.idempotencyKey.length > 0 &&
        /^sha256:[a-f0-9]{64}$/.test(String(value.contentHash)) &&
        typeof value.runId === 'string' &&
        value.runId.length > 0 &&
        typeof value.batchId === 'string' &&
        value.batchId.length > 0
    );
}

function isAssetRecord(value: unknown): value is AssetRecord {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const record = value as Record<string, unknown>;
    return (
        record.schemaVersion === RECORD_SCHEMA_VERSION &&
        typeof record.hash === 'string' &&
        record.blob instanceof Blob &&
        typeof record.name === 'string' &&
        Array.isArray(record.ownerIds) &&
        record.ownerIds.every((ownerId) => typeof ownerId === 'string') &&
        Array.isArray(record.leaseOwnerIds) &&
        record.leaseOwnerIds.every((ownerId) => typeof ownerId === 'string') &&
        Array.isArray(record.activeLeases) &&
        record.activeLeases.every(
            (lease) =>
                typeof lease === 'object' &&
                lease !== null &&
                typeof (lease as ActiveLease).leaseId === 'string' &&
                typeof (lease as ActiveLease).ownerId === 'string'
        )
    );
}

function isLeaseRecord(value: unknown): value is LeaseRecord {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const record = value as Record<string, unknown>;
    return (
        record.schemaVersion === RECORD_SCHEMA_VERSION &&
        typeof record.leaseId === 'string' &&
        typeof record.ownerId === 'string' &&
        typeof record.hash === 'string' &&
        (record.state === 'staged' || record.state === 'promoted' || record.state === 'released') &&
        (record.state === 'staged'
            ? record.terminalAt === undefined
            : typeof record.terminalAt === 'number' && Number.isSafeInteger(record.terminalAt))
    );
}

function isOwnerHandoffRecord(value: unknown): value is OwnerHandoffRecord {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const record = value as Record<string, unknown>;
    return (
        record.schemaVersion === OWNER_HANDOFF_SCHEMA_VERSION &&
        typeof record.previousOwnerId === 'string' &&
        typeof record.nextOwnerId === 'string' &&
        typeof record.preparedAt === 'number' &&
        Number.isSafeInteger(record.preparedAt)
    );
}

function isOwnerAuthorityRecord(value: unknown): value is OwnerAuthorityRecord {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const record = value as Record<string, unknown>;
    return (
        record.schemaVersion === OWNER_AUTHORITY_SCHEMA_VERSION &&
        typeof record.ownerId === 'string' &&
        record.ownerId.length > 0 &&
        typeof record.canonicalOwnerId === 'string' &&
        record.canonicalOwnerId.length > 0 &&
        typeof record.epoch === 'number' &&
        Number.isSafeInteger(record.epoch) &&
        record.epoch >= 0
    );
}

function hasValidPromotionRecoveryFields(
    record: Record<string, unknown>,
    schemaVersion: number,
    isValidCommitProof: (value: unknown) => boolean
): boolean {
    const recoveryLeaseIds = Array.isArray(record.leaseIds)
        ? record.leaseIds.filter((leaseId): leaseId is string => typeof leaseId === 'string')
        : [];
    if (
        record.schemaVersion !== schemaVersion ||
        typeof record.recoveryId !== 'string' ||
        record.recoveryId.length === 0 ||
        typeof record.ownerId !== 'string' ||
        record.ownerId.length === 0 ||
        !Array.isArray(record.leaseIds) ||
        recoveryLeaseIds.length !== record.leaseIds.length ||
        !Array.isArray(record.bindings) ||
        record.bindings.length === 0 ||
        (record.disposition !== 'promote' && record.disposition !== 'release') ||
        (record.disposition === 'promote' &&
            record.promotionState !== 'prepared' &&
            record.promotionState !== 'committed') ||
        (record.disposition === 'release' && record.promotionState !== undefined) ||
        (record.recoveryKind !== undefined &&
            record.recoveryKind !== 'default-release' &&
            record.recoveryKind !== 'explicit') ||
        (record.recoveryKind === 'default-release' && record.disposition !== 'release') ||
        (record.commitProof !== undefined && !isValidCommitProof(record.commitProof)) ||
        (record.commitProof !== undefined && record.disposition !== 'promote') ||
        typeof record.preparedAt !== 'number' ||
        !Number.isSafeInteger(record.preparedAt)
    ) {
        return false;
    }
    const leaseIds = new Set<string>();
    for (const binding of record.bindings) {
        if (
            typeof binding !== 'object' ||
            binding === null ||
            typeof (binding as { leaseId?: unknown }).leaseId !== 'string' ||
            (binding as { leaseId: string }).leaseId.length === 0 ||
            typeof (binding as { expectedHash?: unknown }).expectedHash !== 'string' ||
            (binding as { expectedHash: string }).expectedHash.length === 0 ||
            leaseIds.has((binding as { leaseId: string }).leaseId)
        ) {
            return false;
        }
        leaseIds.add((binding as { leaseId: string }).leaseId);
    }
    return leaseIds.size === recoveryLeaseIds.length && recoveryLeaseIds.every((leaseId) => leaseIds.has(leaseId));
}

function isLegacyPromotionRecoveryRecord(value: unknown): value is LegacyPromotionRecoveryRecord {
    if (!isRecord(value)) {
        return false;
    }
    if (value.disposition !== undefined && value.disposition !== 'promote' && value.disposition !== 'release') {
        return false;
    }
    const disposition = value.disposition === 'release' ? 'release' : 'promote';
    return hasValidPromotionRecoveryFields(
        {
            ...value,
            disposition,
            ...(disposition === 'promote' ? { promotionState: value.promotionState ?? 'prepared' } : {}),
        },
        LEGACY_PROMOTION_RECOVERY_SCHEMA_VERSION,
        isLegacyPromotionCommitProof
    );
}

function isPromotionRecoveryRecord(value: unknown): value is PromotionRecoveryRecord {
    return (
        isRecord(value) &&
        hasValidPromotionRecoveryFields(value, PROMOTION_RECOVERY_SCHEMA_VERSION, isPromotionCommitProof)
    );
}

async function hashBlob(blob: Blob): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

/** Construct the bounded IndexedDB record/transaction adapter. */
export function createDurableAssetIndexedDb() {
    return {
        awaitTransaction,
        hashBlob,
        isAssetRecord,
        isLeaseRecord,
        isOwnerAuthorityRecord,
        isOwnerHandoffRecord,
        isPromotionRecoveryRecord,
        openDurableAssetDatabase,
        readIndexedValues,
        readStoredValue,
    };
}
