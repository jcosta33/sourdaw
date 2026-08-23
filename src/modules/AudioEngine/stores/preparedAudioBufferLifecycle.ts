import {
    finalizedOwner,
    isValidPreparedAudioBufferPair,
    PREPARED_AUDIO_RECOVERY_MIGRATION_MARKER_KEY,
    preparedAudioRecoveryKey,
    preparedIdentityFailure,
    promotedOwner,
    readPreparedAudioRecoveryMetadata,
    readPreparedAudioRecoveryRecord,
    readPreparedOwner,
    requiresPromotionReconciliation,
    serializedBuffersEqual,
    temporaryOwner,
    type PreparedAudioBufferMetadata,
    type PreparedAudioBufferOwner,
    type PreparedAudioBufferRecoveryMetadata,
    type PreparedAudioBufferRecoveryRecord,
    type PreparedSerializedAudioBuffer,
} from './preparedAudioBufferOwnership';
import { createPreparedAudioBufferPersistenceAttempts } from './preparedAudioBufferPersistenceAttempts';
import {
    abortPreparedTransaction,
    awaitPreparedRequest,
    awaitPreparedTransaction,
    createPreparedAudioBufferTransactionLedger,
    type PreparedTransaction,
} from './preparedAudioBufferTransactions';

type RuntimeOwner =
    | { kind: 'ordinary'; token: number }
    | { kind: 'reservation'; leaseId: string; token: number }
    | {
          kind: 'prepared';
          leaseId: string;
          persistenceRevision?: string;
          reservationLeaseId?: string;
          status: 'project-owned' | 'temporary';
          token: number;
      };

type TemporaryPublicationSnapshot = {
    leaseId: string;
    projectEpoch: number;
    token: number;
};

type PromotionSettlement = {
    settled: Promise<void>;
    settle: () => void;
};

type PreparedRuntimeSnapshot = {
    buffer: AudioBuffer;
    lastAccessed: number;
    owner: PreparedAudioBufferOwner;
};

type PersistPreparedAudioBufferInput = {
    data: PreparedSerializedAudioBuffer;
    id: string;
    leaseId: string;
};

type ReopenPreparedAudioBufferInput = {
    context: Pick<BaseAudioContext, 'createBuffer'>;
    id: string;
    leaseId: string;
};

type ReleasePreparedAudioBufferInput = {
    disposition: 'discard' | 'project-owned';
    id: string;
    leaseId: string;
};

type ReclaimPreparedAudioBufferOrphansInput = {
    createdBeforeMs: number;
    liveLeaseIds: readonly string[];
};

type CollectPreparedAudioBufferRecoveriesInput = {
    maxSizeBytes?: number;
    staleBeforeMs?: number;
};

type PreparedAudioBufferLifecycleHost = {
    bufferStoreName: string;
    claimDurableMutation: (id: string) => number;
    createRuntimeBuffer: (data: PreparedSerializedAudioBuffer) => AudioBuffer;
    evictRuntime: (id: string) => void;
    finishDurableMutation: (id: string, generation: number) => void;
    hasPinnedReservation: (id: string) => boolean;
    hasRuntime: (id: string) => boolean;
    isDurableMutationCurrent: (id: string, generation: number) => boolean;
    isValidSerializedBuffer: (data: PreparedSerializedAudioBuffer | undefined) => data is PreparedSerializedAudioBuffer;
    metadataStoreName: string;
    openDatabase: () => Promise<IDBDatabase>;
    publishRuntime: (id: string, buffer: AudioBuffer, lastAccessed: number) => void;
    recoveryStoreName: string;
};

function failureReason(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function estimateStoredRecoveryBytes(value: unknown, visited = new WeakSet<object>()): number {
    if (value === null || value === undefined) {
        return 0;
    }
    if (typeof value === 'boolean') {
        return 1;
    }
    if (ArrayBuffer.isView(value)) {
        return Math.max(1, value.byteLength);
    }
    if (typeof value === 'number') {
        return 8;
    }
    if (typeof value === 'bigint') {
        return Math.max(8, value.toString().length * 2);
    }
    if (typeof value === 'string') {
        return value.length * 2;
    }
    if (typeof value !== 'object' || visited.has(value)) {
        return 0;
    }
    visited.add(value);
    const cloneTag = Object.prototype.toString.call(value);
    if (cloneTag === '[object ArrayBuffer]' || cloneTag === '[object SharedArrayBuffer]') {
        return Math.max(1, (value as ArrayBufferLike).byteLength);
    }
    if (cloneTag === '[object Blob]') {
        return Math.max(1, (value as Blob).size);
    }
    if (cloneTag === '[object Date]') {
        return 8;
    }
    if (cloneTag === '[object RegExp]') {
        const expression = value as RegExp;
        return Math.max(1, (expression.source.length + expression.flags.length) * 2);
    }
    if (cloneTag === '[object Map]') {
        let total = 1;
        for (const [key, entry] of value as Map<unknown, unknown>) {
            total += estimateStoredRecoveryBytes(key, visited) + estimateStoredRecoveryBytes(entry, visited);
        }
        return total;
    }
    if (cloneTag === '[object Set]') {
        let total = 1;
        for (const entry of value as Set<unknown>) {
            total += estimateStoredRecoveryBytes(entry, visited);
        }
        return total;
    }
    if (Array.isArray(value)) {
        const entries: unknown[] = value;
        return entries.reduce<number>((total, entry) => total + estimateStoredRecoveryBytes(entry, visited), 1);
    }
    return Object.entries(value).reduce(
        (total, [key, entry]) => total + key.length * 2 + estimateStoredRecoveryBytes(entry, visited),
        1
    );
}

/**
 * Owns the prepared-PCM state machine across IndexedDB and the synchronous
 * playback cache. The host exposes ordinary cache mechanics; only this
 * coordinator may classify a prepared row or publish, promote, discard, and
 * reclaim its lease.
 */
export function createPreparedAudioBufferLifecycle(host: PreparedAudioBufferLifecycleHost) {
    let nextReopenToken = 0;
    let nextRuntimeToken = 0;
    let projectEpoch = 0;
    const activeDiscardCountById = new Map<string, number>();
    const activeReopenTokenById = new Map<string, number>();
    const activePromotionSettlementsById = new Map<string, Set<PromotionSettlement>>();
    const provisionalProjectReservationCountById = new Map<string, number>();
    const runtimeOwnerById = new Map<string, RuntimeOwner>();
    const projectReservationEpochById = new Map<string, number>();
    const transactions = createPreparedAudioBufferTransactionLedger();
    const persistenceAttempts = createPreparedAudioBufferPersistenceAttempts(clearProjectReservationEpochIfIdle);

    function clearProjectReservationEpochIfIdle(id: string): void {
        if (
            !host.hasPinnedReservation(id) &&
            !provisionalProjectReservationCountById.has(id) &&
            !persistenceAttempts.hasActiveLeases(id) &&
            !activeDiscardCountById.has(id)
        ) {
            projectReservationEpochById.delete(id);
        }
    }

    function nextToken(): number {
        return ++nextRuntimeToken;
    }

    function invalidateReopen(id: string): void {
        activeReopenTokenById.delete(id);
    }

    function beginPromotionSettlement(id: string): PromotionSettlement {
        let settle = (): void => undefined;
        const settled = new Promise<void>((resolve) => {
            settle = resolve;
        });
        const promotion = { settled, settle };
        const active = activePromotionSettlementsById.get(id) ?? new Set<PromotionSettlement>();
        active.add(promotion);
        activePromotionSettlementsById.set(id, active);
        return promotion;
    }

    function finishPromotionSettlement(id: string, promotion: PromotionSettlement | undefined): void {
        if (!promotion) {
            return;
        }
        promotion.settle();
        const active = activePromotionSettlementsById.get(id);
        active?.delete(promotion);
        if (active?.size === 0) {
            activePromotionSettlementsById.delete(id);
        }
    }

    async function waitForPromotionSettlements(id: string): Promise<void> {
        for (;;) {
            const active = activePromotionSettlementsById.get(id);
            if (!active || active.size === 0) {
                return;
            }
            await Promise.all([...active].map((promotion) => promotion.settled));
        }
    }

    function beginDiscardAttempt(id: string): void {
        activeDiscardCountById.set(id, (activeDiscardCountById.get(id) ?? 0) + 1);
    }

    function finishDiscardAttempt(id: string): void {
        const remaining = (activeDiscardCountById.get(id) ?? 1) - 1;
        if (remaining > 0) {
            activeDiscardCountById.set(id, remaining);
            return;
        }
        activeDiscardCountById.delete(id);
        clearProjectReservationEpochIfIdle(id);
    }

    function recordOrdinaryRuntimeMutation(id: string): void {
        invalidateReopen(id);
        runtimeOwnerById.set(id, { kind: 'ordinary', token: nextToken() });
        transactions.abort(id, 'promotion');
    }

    function recordRuntimeVacated(id: string): void {
        invalidateReopen(id);
        runtimeOwnerById.delete(id);
        nextToken();
        transactions.abort(id, 'promotion');
    }

    function beginProjectTransition(retainedIds?: ReadonlySet<string>): void {
        projectEpoch++;
        activeReopenTokenById.clear();
        transactions.abortAll('discard');
        transactions.abortAll('promotion');
        transactions.abortAll('reclamation');
        transactions.abortAll('recovery-cleanup');
        for (const [id, owner] of runtimeOwnerById) {
            if (owner.kind === 'reservation') {
                runtimeOwnerById.delete(id);
                continue;
            }
            if (owner.kind === 'prepared' && owner.status === 'temporary') {
                runtimeOwnerById.delete(id);
                host.evictRuntime(id);
                continue;
            }
            if (!retainedIds?.has(id)) {
                runtimeOwnerById.delete(id);
            }
        }
    }

    function recordProjectReservations(ids: readonly string[]): void {
        for (const id of new Set(ids)) {
            signalProjectReservation(id, true);
        }
        for (const id of projectReservationEpochById.keys()) {
            clearProjectReservationEpochIfIdle(id);
        }
    }

    function signalProjectReservation(id: string, evictTemporaryRuntime: boolean): void {
        projectReservationEpochById.set(id, (projectReservationEpochById.get(id) ?? 0) + 1);
        invalidateReopen(id);
        transactions.abort(id, 'discard');
        transactions.abort(id, 'persistence');
        transactions.abort(id, 'reclamation');
        transactions.abort(id, 'recovery-cleanup');
        transactions.abort(id, 'reopen');
        const runtimeOwner = runtimeOwnerById.get(id);
        if (evictTemporaryRuntime && runtimeOwner?.kind === 'prepared' && runtimeOwner.status === 'temporary') {
            evictPreparedRuntimeIfOwned(id, runtimeOwner.leaseId);
        }
    }

    function hasProjectReservation(id: string): boolean {
        return host.hasPinnedReservation(id) || provisionalProjectReservationCountById.has(id);
    }

    function beginProjectReservations(ids: readonly string[]) {
        const reservedIds = [...new Set(ids)];
        let active = true;
        for (const id of reservedIds) {
            provisionalProjectReservationCountById.set(id, (provisionalProjectReservationCountById.get(id) ?? 0) + 1);
            signalProjectReservation(id, false);
        }
        const finish = (): void => {
            if (!active) {
                return;
            }
            active = false;
            for (const id of reservedIds) {
                const remaining = (provisionalProjectReservationCountById.get(id) ?? 1) - 1;
                if (remaining > 0) {
                    provisionalProjectReservationCountById.set(id, remaining);
                } else {
                    provisionalProjectReservationCountById.delete(id);
                }
                clearProjectReservationEpochIfIdle(id);
            }
        };
        return { promote: finish, release: finish };
    }

    function isRuntimeSlotAvailable(id: string, leaseId: string): boolean {
        const owner = runtimeOwnerById.get(id);
        if (!host.hasRuntime(id)) {
            return owner === undefined || (owner.kind === 'reservation' && owner.leaseId === leaseId);
        }
        return (
            owner?.kind === 'prepared' &&
            owner.leaseId === leaseId &&
            (owner.reservationLeaseId === undefined || owner.reservationLeaseId === leaseId)
        );
    }

    function isRuntimeSlotAvailableForPersist(id: string, leaseId: string): boolean {
        if (isRuntimeSlotAvailable(id, leaseId)) {
            return true;
        }
        const owner = runtimeOwnerById.get(id);
        if (
            !host.hasRuntime(id) &&
            owner?.kind === 'reservation' &&
            persistenceAttempts.isLeaseActive(id, owner.leaseId)
        ) {
            return true;
        }
        return (
            owner?.kind === 'prepared' &&
            owner.status === 'temporary' &&
            (owner.reservationLeaseId === leaseId || persistenceAttempts.isLeaseActive(id, owner.leaseId))
        );
    }

    function isPromotionCurrent(id: string, leaseId: string, admittedEpoch: number, admittedToken?: number): boolean {
        return (
            projectEpoch === admittedEpoch &&
            runtimeOwnerById.get(id)?.token === admittedToken &&
            isRuntimeSlotAvailable(id, leaseId)
        );
    }

    function isDiscardSuperseded(id: string, admittedEpoch: number, admittedReservationEpoch?: number): boolean {
        return (
            projectEpoch !== admittedEpoch ||
            hasProjectReservation(id) ||
            projectReservationEpochById.get(id) !== admittedReservationEpoch
        );
    }

    function publishPreparedRuntime(
        id: string,
        leaseId: string,
        status: 'project-owned' | 'temporary',
        buffer: AudioBuffer,
        lastAccessed: number,
        persistenceRevision?: string
    ): void {
        invalidateReopen(id);
        runtimeOwnerById.set(id, { kind: 'prepared', leaseId, persistenceRevision, status, token: nextToken() });
        host.publishRuntime(id, buffer, lastAccessed);
    }

    function evictPreparedRuntimeIfOwned(id: string, leaseId: string, admittedToken?: number): void {
        const owner = runtimeOwnerById.get(id);
        if (
            owner?.kind !== 'prepared' ||
            owner.leaseId !== leaseId ||
            owner.status !== 'temporary' ||
            (admittedToken !== undefined && owner.token !== admittedToken)
        ) {
            return;
        }
        invalidateReopen(id);
        runtimeOwnerById.delete(id);
        nextToken();
        host.evictRuntime(id);
    }

    async function readDurableOwner(id: string): Promise<PreparedAudioBufferOwner | null | 'invalid'> {
        const database = await host.openDatabase();
        const transaction = database.transaction(host.metadataStoreName, 'readonly');
        const metadata = await awaitPreparedRequest(
            transaction.objectStore(host.metadataStoreName).get(id) as IDBRequest<
                PreparedAudioBufferMetadata | undefined
            >
        );
        await awaitPreparedTransaction(transaction);
        return readPreparedOwner(metadata);
    }

    async function discardTemporaryLeaseIfExact(
        id: string,
        leaseId: string,
        persistenceRevision: string
    ): Promise<void> {
        const database = await host.openDatabase();
        const transaction = database.transaction([host.bufferStoreName, host.metadataStoreName], 'readwrite');
        const tracked = transactions.track(id, 'reconciliation', transaction);
        try {
            const metadataStore = transaction.objectStore(host.metadataStoreName);
            const metadata = await awaitPreparedRequest(
                metadataStore.get(id) as IDBRequest<PreparedAudioBufferMetadata | undefined>
            );
            const owner = readPreparedOwner(metadata);
            if (
                owner !== 'invalid' &&
                owner?.status === 'temporary' &&
                owner.leaseId === leaseId &&
                owner.persistenceRevision === persistenceRevision
            ) {
                transaction.objectStore(host.bufferStoreName).delete(id);
                metadataStore.delete(id);
            }
            await awaitPreparedTransaction(transaction);
        } finally {
            transactions.untrack(id, tracked);
        }
    }

    async function rollbackPromotionIfExact(id: string, leaseId: string, promotionRevision: string): Promise<boolean> {
        const database = await host.openDatabase();
        const transaction = database.transaction(host.metadataStoreName, 'readwrite');
        const tracked = transactions.track(id, 'reconciliation', transaction);
        let rolledBack = false;
        try {
            const metadataStore = transaction.objectStore(host.metadataStoreName);
            const metadata = await awaitPreparedRequest(
                metadataStore.get(id) as IDBRequest<PreparedAudioBufferMetadata | undefined>
            );
            const owner = readPreparedOwner(metadata);
            if (
                metadata !== undefined &&
                owner !== 'invalid' &&
                owner?.status === 'project-owned' &&
                owner.leaseId === leaseId &&
                owner.promotionRevision === promotionRevision
            ) {
                metadataStore.put(
                    {
                        ...metadata,
                        preparedOwner: temporaryOwner(owner),
                    } satisfies PreparedAudioBufferMetadata,
                    id
                );
                rolledBack = true;
            }
            await awaitPreparedTransaction(transaction);
            return rolledBack;
        } finally {
            transactions.untrack(id, tracked);
        }
    }

    async function finalizePromotionIfExact(id: string, leaseId: string, promotionRevision: string): Promise<boolean> {
        const database = await host.openDatabase();
        const transaction = database.transaction(host.metadataStoreName, 'readwrite');
        const tracked = transactions.track(id, 'promotion', transaction);
        let finalized = false;
        try {
            const metadataStore = transaction.objectStore(host.metadataStoreName);
            const metadata = await awaitPreparedRequest(
                metadataStore.get(id) as IDBRequest<PreparedAudioBufferMetadata | undefined>
            );
            const owner = readPreparedOwner(metadata);
            if (
                metadata !== undefined &&
                owner !== 'invalid' &&
                owner?.status === 'project-owned' &&
                owner.leaseId === leaseId &&
                owner.promotionRevision === promotionRevision
            ) {
                metadataStore.put(
                    {
                        ...metadata,
                        preparedOwner: finalizedOwner(owner),
                    } satisfies PreparedAudioBufferMetadata,
                    id
                );
                finalized = true;
            }
            await awaitPreparedTransaction(transaction);
            return finalized;
        } finally {
            transactions.untrack(id, tracked);
        }
    }

    function stagePreparedRecovery(
        recoveryStore: IDBObjectStore,
        id: string,
        revision: string,
        operation: PreparedAudioBufferRecoveryMetadata['operation'],
        data: PreparedSerializedAudioBuffer,
        metadata: PreparedAudioBufferMetadata
    ): void {
        recoveryStore.put(
            {
                data,
                id,
                metadata,
                operation,
                revision,
                schemaVersion: 1,
                stagedAtMs: Date.now(),
            } satisfies PreparedAudioBufferRecoveryRecord,
            id
        );
    }

    async function restorePreparedRecoveryInTransaction(
        bufferStore: IDBObjectStore,
        metadataStore: IDBObjectStore,
        recoveryStore: IDBObjectStore,
        id: string,
        revision: string
    ): Promise<boolean> {
        const [recoveryValue, currentData, currentMetadata] = await Promise.all([
            awaitPreparedRequest(recoveryStore.get(id) as IDBRequest<unknown>),
            awaitPreparedRequest(bufferStore.get(id) as IDBRequest<PreparedSerializedAudioBuffer | undefined>),
            awaitPreparedRequest(metadataStore.get(id) as IDBRequest<PreparedAudioBufferMetadata | undefined>),
        ]);
        const recovery = readPreparedAudioRecoveryRecord(recoveryValue);
        if (
            recovery?.id !== id ||
            recovery.revision !== revision ||
            currentData !== undefined ||
            currentMetadata !== undefined
        ) {
            return false;
        }
        const owner = readPreparedOwner(recovery.metadata);
        if (owner === null || owner === 'invalid') {
            return false;
        }
        bufferStore.put(recovery.data, id);
        metadataStore.put(
            { ...recovery.metadata, preparedOwner: finalizedOwner(owner) } satisfies PreparedAudioBufferMetadata,
            id
        );
        recoveryStore.delete(id);
        return true;
    }

    async function restorePreparedRecoveryIfExact(id: string, revision: string): Promise<boolean> {
        const database = await host.openDatabase();
        const transaction = database.transaction(
            [host.bufferStoreName, host.metadataStoreName, host.recoveryStoreName],
            'readwrite'
        );
        const tracked = transactions.track(id, 'reconciliation', transaction);
        try {
            const restored = await restorePreparedRecoveryInTransaction(
                transaction.objectStore(host.bufferStoreName),
                transaction.objectStore(host.metadataStoreName),
                transaction.objectStore(host.recoveryStoreName),
                id,
                revision
            );
            await awaitPreparedTransaction(transaction);
            return restored;
        } finally {
            transactions.untrack(id, tracked);
        }
    }

    async function deletePreparedRecoveryIfExact(
        id: string,
        revision: string,
        persistenceRevision: string
    ): Promise<'deleted' | 'failed' | 'superseded'> {
        const database = await host.openDatabase();
        if (hasProjectReservation(id)) {
            return 'failed';
        }
        const transaction = database.transaction(
            [host.bufferStoreName, host.metadataStoreName, host.recoveryStoreName],
            'readwrite'
        );
        const tracked = transactions.track(id, 'recovery-cleanup', transaction);
        try {
            const bufferStore = transaction.objectStore(host.bufferStoreName);
            const metadataStore = transaction.objectStore(host.metadataStoreName);
            const recoveryStore = transaction.objectStore(host.recoveryStoreName);
            const [recoveryValue, currentData, currentMetadata] = await Promise.all([
                awaitPreparedRequest(recoveryStore.get(id) as IDBRequest<unknown>),
                awaitPreparedRequest(bufferStore.get(id) as IDBRequest<PreparedSerializedAudioBuffer | undefined>),
                awaitPreparedRequest(metadataStore.get(id) as IDBRequest<PreparedAudioBufferMetadata | undefined>),
            ]);
            const recovery = readPreparedAudioRecoveryRecord(recoveryValue);
            let result: 'deleted' | 'failed' | 'superseded' = 'failed';
            if (recovery?.id === id && recovery.revision === revision) {
                if (currentData === undefined && currentMetadata === undefined) {
                    recoveryStore.delete(id);
                    result = 'deleted';
                } else if (
                    currentData !== undefined &&
                    currentMetadata !== undefined &&
                    host.isValidSerializedBuffer(currentData) &&
                    Number.isFinite(currentMetadata.lastAccessed) &&
                    currentMetadata.sizeInBytes === currentData.sizeInBytes
                ) {
                    const currentOwner = readPreparedOwner(currentMetadata);
                    if (currentOwner === null) {
                        recoveryStore.delete(id);
                        result = 'deleted';
                    } else if (currentOwner !== 'invalid' && currentOwner.persistenceRevision !== persistenceRevision) {
                        recoveryStore.delete(id);
                        result = 'superseded';
                    }
                }
            }
            await awaitPreparedTransaction(transaction);
            return result;
        } finally {
            transactions.untrack(id, tracked);
        }
    }

    async function recoverProjectReservations(ids: readonly string[]): Promise<void> {
        const uniqueIds = [...new Set(ids)];
        if (uniqueIds.length === 0) {
            return;
        }
        const database = await host.openDatabase();
        const presenceTransaction = database.transaction(
            [host.bufferStoreName, host.metadataStoreName, host.recoveryStoreName],
            'readonly'
        );
        const presenceStore = presenceTransaction.objectStore(host.recoveryStoreName);
        const presenceMetadataStore = presenceTransaction.objectStore(host.metadataStoreName);
        const [presenceValues, legacyPresenceValues] = await Promise.all([
            Promise.all(uniqueIds.map((id) => awaitPreparedRequest(presenceStore.get(id) as IDBRequest<unknown>))),
            Promise.all(
                uniqueIds.map((id) =>
                    awaitPreparedRequest(presenceMetadataStore.get(preparedAudioRecoveryKey(id)) as IDBRequest<unknown>)
                )
            ),
        ]);
        await awaitPreparedTransaction(presenceTransaction);
        const hasRecovery = uniqueIds.some((id, index) => {
            const recovery = readPreparedAudioRecoveryRecord(presenceValues[index]);
            const legacyRecovery = readPreparedAudioRecoveryMetadata(legacyPresenceValues[index]);
            return recovery?.id === id || legacyRecovery?.id === id;
        });
        if (!hasRecovery) {
            return;
        }
        const transaction = database.transaction(
            [host.bufferStoreName, host.metadataStoreName, host.recoveryStoreName],
            'readwrite'
        );
        const recoveryStore = transaction.objectStore(host.recoveryStoreName);
        const bufferStore = transaction.objectStore(host.bufferStoreName);
        const metadataStore = transaction.objectStore(host.metadataStoreName);
        const [recoveryValues, legacyRecoveryValues, legacyDataValues] = await Promise.all([
            Promise.all(uniqueIds.map((id) => awaitPreparedRequest(recoveryStore.get(id) as IDBRequest<unknown>))),
            Promise.all(
                uniqueIds.map((id) =>
                    awaitPreparedRequest(metadataStore.get(preparedAudioRecoveryKey(id)) as IDBRequest<unknown>)
                )
            ),
            Promise.all(
                uniqueIds.map((id) =>
                    awaitPreparedRequest(
                        bufferStore.get(preparedAudioRecoveryKey(id)) as IDBRequest<
                            PreparedSerializedAudioBuffer | undefined
                        >
                    )
                )
            ),
        ]);
        const recoveryById = new Map<string, string>();
        for (let index = 0; index < uniqueIds.length; index++) {
            const id = uniqueIds[index]!;
            const recovery = readPreparedAudioRecoveryRecord(recoveryValues[index]);
            if (recovery?.id === id) {
                recoveryById.set(id, recovery.revision);
                continue;
            }
            const legacyRecovery = readPreparedAudioRecoveryMetadata(legacyRecoveryValues[index]);
            const legacyData = legacyDataValues[index];
            if (
                legacyRecovery?.id === id &&
                legacyData !== undefined &&
                isValidPreparedAudioBufferPair(legacyData, legacyRecovery.metadata)
            ) {
                stagePreparedRecovery(
                    recoveryStore,
                    id,
                    legacyRecovery.revision,
                    legacyRecovery.operation,
                    legacyData,
                    legacyRecovery.metadata
                );
                bufferStore.delete(preparedAudioRecoveryKey(id));
                metadataStore.delete(preparedAudioRecoveryKey(id));
                recoveryById.set(id, legacyRecovery.revision);
            }
        }
        const tracked = [...recoveryById].map(([id]) => ({
            id,
            transaction: transactions.track(id, 'reconciliation', transaction),
        }));
        try {
            for (const [id, revision] of recoveryById) {
                await restorePreparedRecoveryInTransaction(bufferStore, metadataStore, recoveryStore, id, revision);
            }
            await awaitPreparedTransaction(transaction);
        } finally {
            for (const { id, transaction: trackedTransaction } of tracked) {
                transactions.untrack(id, trackedTransaction);
            }
        }
    }

    async function readPreparedRuntimeSnapshot(
        id: string,
        leaseId: string
    ): Promise<PreparedRuntimeSnapshot | undefined> {
        const database = await host.openDatabase();
        const transaction = database.transaction([host.bufferStoreName, host.metadataStoreName], 'readonly');
        const [data, metadata] = await Promise.all([
            awaitPreparedRequest(
                transaction.objectStore(host.bufferStoreName).get(id) as IDBRequest<
                    PreparedSerializedAudioBuffer | undefined
                >
            ),
            awaitPreparedRequest(
                transaction.objectStore(host.metadataStoreName).get(id) as IDBRequest<
                    PreparedAudioBufferMetadata | undefined
                >
            ),
        ]);
        await awaitPreparedTransaction(transaction);
        if (!data || !metadata || !isValidPreparedAudioBufferPair(data, metadata)) {
            return undefined;
        }
        const owner = readPreparedOwner(metadata);
        if (owner === null || owner === 'invalid' || owner.leaseId !== leaseId) {
            return undefined;
        }
        return {
            buffer: host.createRuntimeBuffer(data),
            lastAccessed: metadata.lastAccessed,
            owner,
        };
    }

    async function persist({ data, id, leaseId }: PersistPreparedAudioBufferInput) {
        const invalidIdentity = preparedIdentityFailure(id, leaseId);
        if (invalidIdentity) {
            return { status: 'failed' as const, reason: invalidIdentity };
        }
        if (hasProjectReservation(id)) {
            return { status: 'failed' as const, reason: 'Prepared audio buffer ID is reserved by the project.' };
        }
        if (!isRuntimeSlotAvailableForPersist(id, leaseId)) {
            return { status: 'failed' as const, reason: 'Prepared audio buffer ID is already occupied.' };
        }
        transactions.abort(id, 'promotion');
        transactions.abort(id, 'reclamation');
        const admittedOwner = runtimeOwnerById.get(id);
        const admittedToken = nextToken();
        if (admittedOwner?.kind === 'prepared') {
            runtimeOwnerById.set(id, { ...admittedOwner, reservationLeaseId: leaseId, token: admittedToken });
        } else {
            runtimeOwnerById.set(id, { kind: 'reservation', leaseId, token: admittedToken });
        }
        const admittedProjectEpoch = projectEpoch;
        const admittedReservationEpoch = projectReservationEpochById.get(id);
        const generation = host.claimDurableMutation(id);
        const attempt = persistenceAttempts.register(id, generation, leaseId);
        const persistenceRevision = crypto.randomUUID();
        let committedPersistenceRevision: string = persistenceRevision;
        let committedData = data;
        let reconciledOwnerStatus: PreparedAudioBufferOwner['status'] | undefined;
        let reconciledSnapshot: PreparedRuntimeSnapshot | undefined;
        let trackedTransaction: PreparedTransaction | undefined;
        let wroteTemporaryRow = false;
        try {
            const database = await host.openDatabase();
            if (!host.isDurableMutationCurrent(id, generation)) {
                return { status: 'failed' as const, reason: 'Prepared audio persistence was superseded.' };
            }
            const transaction = database.transaction([host.bufferStoreName, host.metadataStoreName], 'readwrite');
            trackedTransaction = transactions.track(id, 'persistence', transaction);
            const bufferStore = transaction.objectStore(host.bufferStoreName);
            const metadataStore = transaction.objectStore(host.metadataStoreName);
            const [existingData, existingMetadata] = await Promise.all([
                awaitPreparedRequest(bufferStore.get(id) as IDBRequest<PreparedSerializedAudioBuffer | undefined>),
                awaitPreparedRequest(metadataStore.get(id) as IDBRequest<PreparedAudioBufferMetadata | undefined>),
            ]);
            if (hasProjectReservation(id) || projectReservationEpochById.get(id) !== admittedReservationEpoch) {
                await abortPreparedTransaction(transaction);
            }
            const existingOwner = readPreparedOwner(existingMetadata);
            const retryingExactLease =
                existingOwner !== 'invalid' &&
                existingOwner?.status === 'temporary' &&
                existingOwner.leaseId === leaseId;
            if (retryingExactLease) {
                if (
                    existingData === undefined ||
                    existingMetadata === undefined ||
                    !isValidPreparedAudioBufferPair(existingData, existingMetadata)
                ) {
                    await awaitPreparedTransaction(transaction);
                    return {
                        status: 'failed' as const,
                        reason: 'Prepared audio PCM metadata is invalid.',
                    };
                }
                if (!serializedBuffersEqual(existingData, data)) {
                    await awaitPreparedTransaction(transaction);
                    return {
                        status: 'failed' as const,
                        reason: 'Prepared audio retry does not match its durable PCM.',
                    };
                }
                committedData = existingData;
                if (existingOwner.persistenceRevision === undefined) {
                    metadataStore.put(
                        {
                            ...existingMetadata,
                            preparedOwner: { ...existingOwner, persistenceRevision },
                        } satisfies PreparedAudioBufferMetadata,
                        id
                    );
                } else {
                    committedPersistenceRevision = existingOwner.persistenceRevision;
                }
                await awaitPreparedTransaction(transaction);
            } else {
                const occupied = existingData !== undefined || existingMetadata !== undefined;
                const replaceableActiveOwner =
                    existingOwner !== 'invalid' &&
                    existingOwner?.status === 'temporary' &&
                    (persistenceAttempts.isLeaseActive(id, existingOwner.leaseId) ||
                        (admittedOwner?.kind === 'prepared' &&
                            admittedOwner.status === 'temporary' &&
                            admittedOwner.leaseId === existingOwner.leaseId));
                if (!isRuntimeSlotAvailableForPersist(id, leaseId) || (occupied && !replaceableActiveOwner)) {
                    await awaitPreparedTransaction(transaction);
                    return { status: 'failed' as const, reason: 'Prepared audio buffer ID is already occupied.' };
                }
                bufferStore.put(data, id);
                metadataStore.put(
                    {
                        lastAccessed: data.lastAccessed,
                        preparedOwner: {
                            schemaVersion: 1,
                            createdAtMs: Date.now(),
                            leaseId,
                            persistenceRevision,
                            status: 'temporary',
                        },
                        sizeInBytes: data.sizeInBytes,
                    } satisfies PreparedAudioBufferMetadata,
                    id
                );
                wroteTemporaryRow = true;
                await awaitPreparedTransaction(transaction);
            }
            if (hasProjectReservation(id) || projectReservationEpochById.get(id) !== admittedReservationEpoch) {
                if (wroteTemporaryRow) {
                    await discardTemporaryLeaseIfExact(id, leaseId, persistenceRevision);
                }
                return { status: 'failed' as const, reason: 'Prepared audio buffer ID is reserved by the project.' };
            }
            if (!host.isDurableMutationCurrent(id, generation)) {
                await persistenceAttempts.waitForSuperseding(id, generation);
                let owner = await readDurableOwner(id);
                if (owner === 'invalid' || owner?.leaseId !== leaseId) {
                    return { status: 'failed' as const, reason: 'Prepared audio persistence was superseded.' };
                }
                if (requiresPromotionReconciliation(owner)) {
                    await waitForPromotionSettlements(id);
                    owner = await readDurableOwner(id);
                    if (owner === 'invalid' || owner?.leaseId !== leaseId) {
                        return { status: 'failed' as const, reason: 'Prepared audio persistence was superseded.' };
                    }
                    if (requiresPromotionReconciliation(owner)) {
                        return {
                            status: 'failed' as const,
                            reason: 'Prepared audio ownership requires reconciliation.',
                        };
                    }
                }
                reconciledOwnerStatus = owner.status;
                committedPersistenceRevision = owner.persistenceRevision ?? committedPersistenceRevision;
                reconciledSnapshot = await readPreparedRuntimeSnapshot(id, leaseId);
            }
            const canPublish =
                projectEpoch === admittedProjectEpoch &&
                ((runtimeOwnerById.get(id)?.token === admittedToken && isRuntimeSlotAvailableForPersist(id, leaseId)) ||
                    (reconciledOwnerStatus !== undefined &&
                        runtimeOwnerById.get(id) === undefined &&
                        !host.hasRuntime(id)));
            let snapshot: PreparedRuntimeSnapshot | undefined;
            if (canPublish && reconciledOwnerStatus !== undefined) {
                snapshot = reconciledSnapshot;
            } else if (canPublish) {
                snapshot = {
                    buffer: host.createRuntimeBuffer(committedData),
                    lastAccessed: committedData.lastAccessed,
                    owner: {
                        schemaVersion: 1,
                        leaseId,
                        persistenceRevision: committedPersistenceRevision,
                        status: 'temporary',
                    },
                };
            }
            const currentOwner = runtimeOwnerById.get(id);
            if (
                snapshot !== undefined &&
                projectEpoch === admittedProjectEpoch &&
                !hasProjectReservation(id) &&
                projectReservationEpochById.get(id) === admittedReservationEpoch &&
                ((currentOwner?.token === admittedToken && isRuntimeSlotAvailableForPersist(id, leaseId)) ||
                    (reconciledOwnerStatus !== undefined && currentOwner === undefined && !host.hasRuntime(id)))
            ) {
                publishPreparedRuntime(
                    id,
                    leaseId,
                    snapshot.owner.status,
                    snapshot.buffer,
                    snapshot.lastAccessed,
                    snapshot.owner.persistenceRevision ?? committedPersistenceRevision
                );
            }
            return { status: 'persisted' as const, bufferId: id, leaseId };
        } catch (error) {
            if (hasProjectReservation(id) || projectReservationEpochById.get(id) !== admittedReservationEpoch) {
                return { status: 'failed' as const, reason: 'Prepared audio buffer ID is reserved by the project.' };
            }
            return { status: 'failed' as const, reason: failureReason(error) };
        } finally {
            transactions.untrack(id, trackedTransaction);
            const runtimeOwner = runtimeOwnerById.get(id);
            if (
                runtimeOwner?.kind === 'prepared' &&
                runtimeOwner.reservationLeaseId === leaseId &&
                runtimeOwner.token === admittedToken
            ) {
                runtimeOwnerById.set(id, {
                    kind: 'prepared',
                    leaseId: runtimeOwner.leaseId,
                    persistenceRevision: runtimeOwner.persistenceRevision,
                    status: runtimeOwner.status,
                    token: runtimeOwner.token,
                });
            } else if (
                runtimeOwner?.kind === 'reservation' &&
                runtimeOwner.leaseId === leaseId &&
                runtimeOwner.token === admittedToken
            ) {
                runtimeOwnerById.delete(id);
            }
            persistenceAttempts.unregister(id, leaseId, attempt);
            host.finishDurableMutation(id, generation);
        }
    }

    async function reopen({ context, id, leaseId }: ReopenPreparedAudioBufferInput) {
        const invalidIdentity = preparedIdentityFailure(id, leaseId);
        if (invalidIdentity) {
            return { status: 'failed' as const, reason: invalidIdentity };
        }
        if (hasProjectReservation(id)) {
            return { status: 'failed' as const, reason: 'Prepared audio buffer ID is reserved by the project.' };
        }
        if (!isRuntimeSlotAvailable(id, leaseId)) {
            return { status: 'failed' as const, reason: 'Prepared audio buffer ID is already occupied.' };
        }
        transactions.abort(id, 'reclamation');
        const admittedOwner = runtimeOwnerById.get(id);
        const admittedToken = admittedOwner?.token;
        const admittedProjectEpoch = projectEpoch;
        const reopenToken = ++nextReopenToken;
        activeReopenTokenById.set(id, reopenToken);
        let trackedTransaction: PreparedTransaction | undefined;
        try {
            const database = await host.openDatabase();
            const transaction = database.transaction([host.bufferStoreName, host.metadataStoreName], 'readonly');
            trackedTransaction = transactions.track(id, 'reopen', transaction);
            const [data, metadata] = await Promise.all([
                awaitPreparedRequest(
                    transaction.objectStore(host.bufferStoreName).get(id) as IDBRequest<
                        PreparedSerializedAudioBuffer | undefined
                    >
                ),
                awaitPreparedRequest(
                    transaction.objectStore(host.metadataStoreName).get(id) as IDBRequest<
                        PreparedAudioBufferMetadata | undefined
                    >
                ),
            ]);
            await awaitPreparedTransaction(transaction);
            if (hasProjectReservation(id)) {
                return { status: 'failed' as const, reason: 'Prepared audio buffer ID is reserved by the project.' };
            }
            const currentOwner = runtimeOwnerById.get(id);
            if (
                projectEpoch !== admittedProjectEpoch ||
                currentOwner?.token !== admittedToken ||
                activeReopenTokenById.get(id) !== reopenToken
            ) {
                return { status: 'failed' as const, reason: 'Prepared audio reopen was superseded.' };
            }
            if (!data || !metadata) {
                return { status: 'missing' as const };
            }
            let owner = readPreparedOwner(metadata);
            if (owner === 'invalid') {
                return { status: 'failed' as const, reason: 'Prepared audio ownership metadata is invalid.' };
            }
            if (!owner || owner.leaseId !== leaseId) {
                return { status: 'mismatched' as const };
            }
            if (requiresPromotionReconciliation(owner)) {
                const reconciled = await rollbackPromotionIfExact(id, leaseId, owner.promotionRevision);
                if (!reconciled) {
                    return { status: 'failed' as const, reason: 'Prepared audio ownership reconciliation failed.' };
                }
                owner = temporaryOwner(owner);
            }
            if (!host.isValidSerializedBuffer(data)) {
                return { status: 'failed' as const, reason: 'Prepared audio PCM is invalid.' };
            }
            if (!Number.isFinite(metadata.lastAccessed) || metadata.sizeInBytes !== data.sizeInBytes) {
                return { status: 'failed' as const, reason: 'Prepared audio metadata does not match its PCM.' };
            }
            if (hasProjectReservation(id)) {
                return { status: 'failed' as const, reason: 'Prepared audio buffer ID is reserved by the project.' };
            }
            if (!isRuntimeSlotAvailable(id, leaseId)) {
                return { status: 'failed' as const, reason: 'Prepared audio buffer ID is already occupied.' };
            }
            if (
                projectEpoch !== admittedProjectEpoch ||
                runtimeOwnerById.get(id)?.token !== admittedToken ||
                activeReopenTokenById.get(id) !== reopenToken
            ) {
                return { status: 'failed' as const, reason: 'Prepared audio reopen was superseded.' };
            }
            const length = data.channelData[0]!.length;
            const buffer = context.createBuffer(data.numberOfChannels, length, data.sampleRate);
            for (let channel = 0; channel < data.numberOfChannels; channel++) {
                buffer.getChannelData(channel).set(data.channelData[channel]!);
            }
            publishPreparedRuntime(id, leaseId, owner.status, buffer, metadata.lastAccessed, owner.persistenceRevision);
            return { status: 'reopened' as const, bufferId: id, ownership: owner.status };
        } catch (error) {
            if (
                projectEpoch !== admittedProjectEpoch ||
                runtimeOwnerById.get(id)?.token !== admittedToken ||
                activeReopenTokenById.get(id) !== reopenToken
            ) {
                return { status: 'failed' as const, reason: 'Prepared audio reopen was superseded.' };
            }
            return { status: 'failed' as const, reason: failureReason(error) };
        } finally {
            transactions.untrack(id, trackedTransaction);
            if (activeReopenTokenById.get(id) === reopenToken) {
                activeReopenTokenById.delete(id);
            }
        }
    }

    async function release({ disposition, id, leaseId }: ReleasePreparedAudioBufferInput) {
        const invalidIdentity = preparedIdentityFailure(id, leaseId);
        if (invalidIdentity) {
            return { status: 'failed' as const, reason: invalidIdentity };
        }
        if (disposition === 'discard' && hasProjectReservation(id)) {
            return { status: 'failed' as const, reason: 'Prepared audio buffer ID is reserved by the project.' };
        }
        if (disposition === 'discard') {
            beginDiscardAttempt(id);
        }
        const admittedProjectEpoch = projectEpoch;
        const admittedReservationEpoch = projectReservationEpochById.get(id);
        const admittedRuntimeToken = runtimeOwnerById.get(id)?.token;
        const promotionRevision = crypto.randomUUID();
        const recoveryRevision = crypto.randomUUID();
        const promotionSettlement = disposition === 'project-owned' ? beginPromotionSettlement(id) : undefined;
        let generation = persistenceAttempts.isLeaseActive(id, leaseId) ? host.claimDurableMutation(id) : undefined;
        let discardCommitted = false;
        let discardRecoveryAttempted = false;
        let promotionCommitted = false;
        let trackedTransaction: PreparedTransaction | undefined;
        try {
            if (disposition === 'project-owned' && !isRuntimeSlotAvailable(id, leaseId)) {
                return { status: 'failed' as const, reason: 'Prepared audio buffer ID is already occupied.' };
            }
            const database = await host.openDatabase();
            if (generation !== undefined && !host.isDurableMutationCurrent(id, generation)) {
                return { status: 'failed' as const, reason: 'Prepared audio settlement was superseded.' };
            }
            const transaction = database.transaction(
                disposition === 'discard'
                    ? [host.bufferStoreName, host.metadataStoreName, host.recoveryStoreName]
                    : [host.bufferStoreName, host.metadataStoreName],
                'readwrite'
            );
            if (disposition === 'project-owned') {
                trackedTransaction = transactions.track(id, 'promotion', transaction);
            } else {
                trackedTransaction = transactions.track(id, 'discard', transaction);
            }
            const bufferStore = transaction.objectStore(host.bufferStoreName);
            const metadataStore = transaction.objectStore(host.metadataStoreName);
            const [data, metadata] = await Promise.all([
                awaitPreparedRequest(bufferStore.get(id) as IDBRequest<PreparedSerializedAudioBuffer | undefined>),
                awaitPreparedRequest(metadataStore.get(id) as IDBRequest<PreparedAudioBufferMetadata | undefined>),
            ]);
            if (disposition === 'discard' && isDiscardSuperseded(id, admittedProjectEpoch, admittedReservationEpoch)) {
                await abortPreparedTransaction(transaction);
            }
            if (!data || !metadata) {
                await awaitPreparedTransaction(transaction);
                if (!data && !metadata) {
                    evictPreparedRuntimeIfOwned(id, leaseId);
                }
                return { status: 'missing' as const };
            }
            let owner = readPreparedOwner(metadata);
            if (owner === 'invalid') {
                await awaitPreparedTransaction(transaction);
                return { status: 'failed' as const, reason: 'Prepared audio ownership metadata is invalid.' };
            }
            if (!owner || owner.leaseId !== leaseId) {
                await awaitPreparedTransaction(transaction);
                return { status: 'mismatched' as const };
            }
            if (!isValidPreparedAudioBufferPair(data, metadata)) {
                await awaitPreparedTransaction(transaction);
                return { status: 'failed' as const, reason: 'Prepared audio PCM metadata is invalid.' };
            }
            if (requiresPromotionReconciliation(owner)) {
                owner = temporaryOwner(owner);
                metadataStore.put(
                    {
                        ...metadata,
                        preparedOwner: owner,
                    } satisfies PreparedAudioBufferMetadata,
                    id
                );
            }
            if (generation === undefined && owner.status === 'temporary') {
                const runtimeOwner = runtimeOwnerById.get(id);
                if (runtimeOwner?.kind === 'ordinary') {
                    await awaitPreparedTransaction(transaction);
                    return { status: 'mismatched' as const };
                }
                generation = host.claimDurableMutation(id);
            }
            if (owner.status === 'project-owned') {
                await awaitPreparedTransaction(transaction);
                if (
                    disposition === 'project-owned' &&
                    !isPromotionCurrent(id, leaseId, admittedProjectEpoch, admittedRuntimeToken)
                ) {
                    return { status: 'failed' as const, reason: 'Prepared audio promotion was superseded.' };
                }
                return { status: 'already-settled' as const, disposition: 'project-owned' as const };
            }
            if (disposition === 'project-owned') {
                if (!isRuntimeSlotAvailable(id, leaseId)) {
                    await abortPreparedTransaction(transaction);
                }
                metadataStore.put(
                    {
                        ...metadata,
                        preparedOwner: promotedOwner(owner, promotionRevision),
                    } satisfies PreparedAudioBufferMetadata,
                    id
                );
                await awaitPreparedTransaction(transaction);
                promotionCommitted = true;
                if (!isPromotionCurrent(id, leaseId, admittedProjectEpoch, admittedRuntimeToken)) {
                    await rollbackPromotionIfExact(id, leaseId, promotionRevision);
                    return { status: 'failed' as const, reason: 'Prepared audio promotion was superseded.' };
                }
                const finalized = await finalizePromotionIfExact(id, leaseId, promotionRevision);
                if (!finalized) {
                    return { status: 'failed' as const, reason: 'Prepared audio promotion could not be finalized.' };
                }
                if (isPromotionCurrent(id, leaseId, admittedProjectEpoch, admittedRuntimeToken)) {
                    const runtimeOwner = runtimeOwnerById.get(id);
                    if (runtimeOwner?.kind === 'prepared' && runtimeOwner.leaseId === leaseId) {
                        runtimeOwnerById.set(id, {
                            kind: 'prepared',
                            leaseId,
                            persistenceRevision: owner.persistenceRevision,
                            status: 'project-owned',
                            token: nextToken(),
                        });
                    }
                }
                return { status: 'released' as const, disposition: 'project-owned' as const };
            }
            const discardedPersistenceRevision = owner.persistenceRevision ?? crypto.randomUUID();
            const recoveryMetadata: PreparedAudioBufferMetadata =
                owner.persistenceRevision === undefined
                    ? {
                          ...metadata,
                          preparedOwner: { ...owner, persistenceRevision: discardedPersistenceRevision },
                      }
                    : metadata;
            stagePreparedRecovery(
                transaction.objectStore(host.recoveryStoreName),
                id,
                recoveryRevision,
                'discard',
                data,
                recoveryMetadata
            );
            bufferStore.delete(id);
            metadataStore.delete(id);
            await awaitPreparedTransaction(transaction);
            discardCommitted = true;
            if (isDiscardSuperseded(id, admittedProjectEpoch, admittedReservationEpoch)) {
                discardRecoveryAttempted = true;
                try {
                    await restorePreparedRecoveryIfExact(id, recoveryRevision);
                } catch (reconciliationError) {
                    return { status: 'failed' as const, reason: failureReason(reconciliationError) };
                }
                return { status: 'failed' as const, reason: 'Prepared audio buffer ID is reserved by the project.' };
            }
            const recoveryCleanup = await deletePreparedRecoveryIfExact(
                id,
                recoveryRevision,
                discardedPersistenceRevision
            );
            if (
                recoveryCleanup !== 'deleted' &&
                isDiscardSuperseded(id, admittedProjectEpoch, admittedReservationEpoch)
            ) {
                await restorePreparedRecoveryIfExact(id, recoveryRevision);
                return { status: 'failed' as const, reason: 'Prepared audio buffer ID is reserved by the project.' };
            }
            if (recoveryCleanup === 'superseded') {
                return { status: 'failed' as const, reason: 'Prepared audio discard was superseded.' };
            }
            if (recoveryCleanup !== 'deleted') {
                return { status: 'failed' as const, reason: 'Prepared audio discard recovery cleanup failed.' };
            }
            evictPreparedRuntimeIfOwned(id, leaseId, admittedRuntimeToken);
            return { status: 'released' as const, disposition: 'discarded' as const };
        } catch (error) {
            if (disposition === 'discard' && isDiscardSuperseded(id, admittedProjectEpoch, admittedReservationEpoch)) {
                if (discardCommitted && !discardRecoveryAttempted) {
                    try {
                        await restorePreparedRecoveryIfExact(id, recoveryRevision);
                    } catch (reconciliationError) {
                        return { status: 'failed' as const, reason: failureReason(reconciliationError) };
                    }
                }
                return { status: 'failed' as const, reason: 'Prepared audio buffer ID is reserved by the project.' };
            }
            if (
                disposition === 'project-owned' &&
                !isPromotionCurrent(id, leaseId, admittedProjectEpoch, admittedRuntimeToken)
            ) {
                if (promotionCommitted) {
                    try {
                        await rollbackPromotionIfExact(id, leaseId, promotionRevision);
                    } catch {
                        // The typed failure remains authoritative; durable recovery can retry.
                    }
                }
                return { status: 'failed' as const, reason: 'Prepared audio promotion was superseded.' };
            }
            if (disposition === 'project-owned' && !isRuntimeSlotAvailable(id, leaseId)) {
                return { status: 'failed' as const, reason: 'Prepared audio buffer ID is already occupied.' };
            }
            return { status: 'failed' as const, reason: failureReason(error) };
        } finally {
            transactions.untrack(id, trackedTransaction);
            if (disposition === 'discard') {
                finishDiscardAttempt(id);
            }
            finishPromotionSettlement(id, promotionSettlement);
            if (generation !== undefined) {
                host.finishDurableMutation(id, generation);
            }
        }
    }

    function captureTemporaryPublications(ids?: readonly string[]): Map<string, TemporaryPublicationSnapshot> {
        const captures = new Map<string, TemporaryPublicationSnapshot>();
        for (const [id, owner] of runtimeOwnerById) {
            if (owner.kind === 'prepared' && owner.status === 'temporary' && (ids === undefined || ids.includes(id))) {
                captures.set(id, { leaseId: owner.leaseId, projectEpoch, token: owner.token });
            }
        }
        return captures;
    }

    function evictCapturedTemporaryPublication(id: string, capture: TemporaryPublicationSnapshot): boolean {
        const owner = runtimeOwnerById.get(id);
        if (
            projectEpoch !== capture.projectEpoch ||
            owner?.kind !== 'prepared' ||
            owner.status !== 'temporary' ||
            owner.leaseId !== capture.leaseId ||
            owner.token !== capture.token
        ) {
            return false;
        }
        evictPreparedRuntimeIfOwned(id, capture.leaseId);
        return true;
    }

    function shouldSuppressNonLeaseRead(
        id: string,
        durableOwner: PreparedAudioBufferOwner | null | 'invalid'
    ): boolean {
        if (durableOwner === 'invalid') {
            return true;
        }
        if (host.hasRuntime(id)) {
            const runtimeOwner = runtimeOwnerById.get(id);
            if (
                runtimeOwner?.kind === 'ordinary' ||
                (runtimeOwner?.kind === 'prepared' && runtimeOwner.status === 'project-owned')
            ) {
                return false;
            }
            if (runtimeOwner?.kind === 'prepared' && runtimeOwner.status === 'temporary') {
                return true;
            }
        }
        return (
            durableOwner?.status === 'temporary' ||
            (durableOwner !== null && requiresPromotionReconciliation(durableOwner))
        );
    }

    async function collectRecoveries({ maxSizeBytes, staleBeforeMs }: CollectPreparedAudioBufferRecoveriesInput) {
        const database = await host.openDatabase();
        const presenceTransaction = database.transaction(host.recoveryStoreName, 'readonly');
        const recoveryKeys = await awaitPreparedRequest(
            presenceTransaction.objectStore(host.recoveryStoreName).getAllKeys()
        );
        await awaitPreparedTransaction(presenceTransaction);
        if (recoveryKeys.length === 0) {
            return { status: 'collected' as const, count: 0, remainingBytes: 0 };
        }
        const transaction = database.transaction(host.recoveryStoreName, 'readwrite');
        const recoveryStore = transaction.objectStore(host.recoveryStoreName);
        const [values, keys] = await Promise.all([
            awaitPreparedRequest(recoveryStore.getAll() as IDBRequest<unknown[]>),
            awaitPreparedRequest(recoveryStore.getAllKeys()),
        ]);
        const tracked: Array<{ id: string; transaction: PreparedTransaction }> = [];
        const entries = keys.flatMap((key, index) => {
            const value = values[index];
            if (key === PREPARED_AUDIO_RECOVERY_MIGRATION_MARKER_KEY) {
                return [];
            }
            const candidate =
                value !== null && typeof value === 'object' && !Array.isArray(value)
                    ? (value as Record<string, unknown>)
                    : undefined;
            const recovery = readPreparedAudioRecoveryRecord(value);
            const id = typeof key === 'string' && key.trim().length > 0 ? key : undefined;
            const stagedAtMs =
                typeof candidate?.stagedAtMs === 'number' && Number.isFinite(candidate.stagedAtMs)
                    ? candidate.stagedAtMs
                    : Number.NEGATIVE_INFINITY;
            const valid = id !== undefined && recovery !== null && recovery.id === id;
            if (id !== undefined) {
                tracked.push({ id, transaction: transactions.track(id, 'recovery-cleanup', transaction) });
            }
            return [
                {
                    id,
                    admittedReservationEpoch: id === undefined ? undefined : projectReservationEpochById.get(id),
                    key,
                    protected:
                        id !== undefined &&
                        (hasProjectReservation(id) ||
                            activeDiscardCountById.has(id) ||
                            persistenceAttempts.hasActiveLeases(id)),
                    sizeInBytes: estimateStoredRecoveryBytes(value),
                    stagedAtMs,
                    valid,
                    value,
                },
            ];
        });
        let remainingBytes = entries.reduce((total, entry) => total + entry.sizeInBytes, 0);
        let deletedCount = 0;
        try {
            const deletions = new Set<IDBValidKey>();
            if (staleBeforeMs !== undefined) {
                for (const entry of entries) {
                    if (!entry.protected && (!entry.valid || entry.stagedAtMs < staleBeforeMs)) {
                        deletions.add(entry.key);
                    }
                }
            }
            if (maxSizeBytes !== undefined) {
                const candidates = entries
                    .filter((entry) => !entry.protected && !deletions.has(entry.key))
                    .sort((alpha, beta) => alpha.stagedAtMs - beta.stagedAtMs);
                const pendingDeletionBytes = entries
                    .filter((entry) => deletions.has(entry.key))
                    .reduce((total, entry) => total + entry.sizeInBytes, 0);
                let projectedBytes = remainingBytes - pendingDeletionBytes;
                for (const entry of candidates) {
                    if (projectedBytes <= maxSizeBytes) {
                        break;
                    }
                    deletions.add(entry.key);
                    projectedBytes -= entry.sizeInBytes;
                }
            }
            for (const entry of entries) {
                if (!deletions.has(entry.key)) {
                    continue;
                }
                recoveryStore.delete(entry.key);
                remainingBytes -= entry.sizeInBytes;
                deletedCount++;
            }
            await awaitPreparedTransaction(transaction);
            const atRisk = entries.filter(
                (entry) =>
                    deletions.has(entry.key) &&
                    entry.id !== undefined &&
                    (hasProjectReservation(entry.id) ||
                        projectReservationEpochById.get(entry.id) !== entry.admittedReservationEpoch)
            );
            if (atRisk.length > 0) {
                const reconciliation = database.transaction(host.recoveryStoreName, 'readwrite');
                const reconciliationStore = reconciliation.objectStore(host.recoveryStoreName);
                for (const entry of atRisk) {
                    const current = await awaitPreparedRequest(
                        reconciliationStore.get(entry.key) as IDBRequest<unknown>
                    );
                    if (current === undefined) {
                        reconciliationStore.put(entry.value, entry.key);
                        remainingBytes += entry.sizeInBytes;
                        deletedCount--;
                    } else {
                        remainingBytes += estimateStoredRecoveryBytes(current);
                    }
                }
                await awaitPreparedTransaction(reconciliation);
            }
            return { status: 'collected' as const, count: deletedCount, remainingBytes };
        } finally {
            for (const { id, transaction: trackedTransaction } of tracked) {
                transactions.untrack(id, trackedTransaction);
            }
        }
    }

    async function reclaimOrphans({ createdBeforeMs, liveLeaseIds }: ReclaimPreparedAudioBufferOrphansInput) {
        if (!Number.isFinite(createdBeforeMs)) {
            return { status: 'failed' as const, reason: 'Prepared audio orphan cutoff is invalid.' };
        }
        const liveLeases = new Set(liveLeaseIds);
        const trackedTransactions: Array<{ id: string; tracked: PreparedTransaction }> = [];
        try {
            const database = await host.openDatabase();
            const transaction = database.transaction(
                [host.bufferStoreName, host.metadataStoreName, host.recoveryStoreName],
                'readwrite'
            );
            const bufferStore = transaction.objectStore(host.bufferStoreName);
            const metadataStore = transaction.objectStore(host.metadataStoreName);
            const recoveryStore = transaction.objectStore(host.recoveryStoreName);
            const [metadataRows, keys] = await Promise.all([
                awaitPreparedRequest(metadataStore.getAll() as IDBRequest<PreparedAudioBufferMetadata[]>),
                awaitPreparedRequest(metadataStore.getAllKeys()),
            ]);
            const reclaimed: Array<{
                admittedReservationEpoch?: number;
                id: string;
                leaseId: string;
                persistenceRevision: string;
                recoveryRevision: string;
            }> = [];
            for (let index = 0; index < keys.length; index++) {
                const id = keys[index];
                const owner = readPreparedOwner(metadataRows[index]);
                if (
                    typeof id !== 'string' ||
                    owner === 'invalid' ||
                    (owner?.status !== 'temporary' && !(owner !== null && requiresPromotionReconciliation(owner))) ||
                    owner.createdAtMs === undefined ||
                    owner.createdAtMs >= createdBeforeMs ||
                    liveLeases.has(owner.leaseId) ||
                    hasProjectReservation(id) ||
                    runtimeOwnerById.has(id)
                ) {
                    continue;
                }
                trackedTransactions.push({
                    id,
                    tracked: transactions.track(id, 'reclamation', transaction),
                });
                const data = await awaitPreparedRequest(
                    bufferStore.get(id) as IDBRequest<PreparedSerializedAudioBuffer | undefined>
                );
                const metadata = metadataRows[index];
                if (!data || !metadata || !isValidPreparedAudioBufferPair(data, metadata)) {
                    continue;
                }
                const recoveryRevision = crypto.randomUUID();
                const persistenceRevision = owner.persistenceRevision ?? crypto.randomUUID();
                const recoveryMetadata: PreparedAudioBufferMetadata =
                    owner.persistenceRevision === undefined
                        ? { ...metadata, preparedOwner: { ...owner, persistenceRevision } }
                        : metadata;
                stagePreparedRecovery(recoveryStore, id, recoveryRevision, 'reclamation', data, recoveryMetadata);
                bufferStore.delete(id);
                metadataStore.delete(id);
                reclaimed.push({
                    admittedReservationEpoch: projectReservationEpochById.get(id),
                    id,
                    leaseId: owner.leaseId,
                    persistenceRevision,
                    recoveryRevision,
                });
            }
            await awaitPreparedTransaction(transaction);
            let reclaimedCount = 0;
            for (const { admittedReservationEpoch, id, leaseId, persistenceRevision, recoveryRevision } of reclaimed) {
                if (hasProjectReservation(id) || projectReservationEpochById.get(id) !== admittedReservationEpoch) {
                    await restorePreparedRecoveryIfExact(id, recoveryRevision);
                    continue;
                }
                const recoveryCleanup = await deletePreparedRecoveryIfExact(id, recoveryRevision, persistenceRevision);
                if (recoveryCleanup !== 'deleted') {
                    if (hasProjectReservation(id)) {
                        await restorePreparedRecoveryIfExact(id, recoveryRevision);
                    }
                    continue;
                }
                evictPreparedRuntimeIfOwned(id, leaseId);
                reclaimedCount++;
            }
            return { status: 'reclaimed' as const, count: reclaimedCount };
        } catch (error) {
            return { status: 'failed' as const, reason: failureReason(error) };
        } finally {
            for (const { id, tracked } of trackedTransactions) {
                transactions.untrack(id, tracked);
            }
        }
    }

    return {
        beginProjectTransition,
        beginProjectReservations,
        captureTemporaryPublications,
        collectRecoveries,
        evictCapturedTemporaryPublication,
        persist,
        readPreparedOwner,
        recoverProjectReservations,
        reclaimOrphans,
        recordOrdinaryRuntimeMutation,
        recordProjectReservations,
        recordRuntimeVacated,
        release,
        reopen,
        shouldSuppressNonLeaseRead,
    };
}
