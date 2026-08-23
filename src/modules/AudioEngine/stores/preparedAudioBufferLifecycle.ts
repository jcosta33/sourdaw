import {
    finalizedOwner,
    isValidPreparedAudioBufferPair,
    preparedIdentityFailure,
    promotedOwner,
    readPreparedOwner,
    requiresPromotionReconciliation,
    serializedBuffersEqual,
    temporaryOwner,
    type PreparedAudioBufferMetadata,
    type PreparedAudioBufferOwner,
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

type PersistPreparedAudioBufferInput = {
    buffer: AudioBuffer;
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

type PreparedAudioBufferLifecycleHost = {
    bufferStoreName: string;
    claimDurableMutation: (id: string) => number;
    evictRuntime: (id: string) => void;
    finishDurableMutation: (id: string, generation: number) => void;
    hasPinnedReservation: (id: string) => boolean;
    hasRuntime: (id: string) => boolean;
    isDurableMutationCurrent: (id: string, generation: number) => boolean;
    isValidSerializedBuffer: (data: PreparedSerializedAudioBuffer | undefined) => data is PreparedSerializedAudioBuffer;
    metadataStoreName: string;
    openDatabase: () => Promise<IDBDatabase>;
    publishRuntime: (id: string, buffer: AudioBuffer, lastAccessed: number) => void;
};

function failureReason(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
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
    const runtimeOwnerById = new Map<string, RuntimeOwner>();
    const projectReservationEpochById = new Map<string, number>();
    const transactions = createPreparedAudioBufferTransactionLedger();
    const persistenceAttempts = createPreparedAudioBufferPersistenceAttempts(clearProjectReservationEpochIfIdle);

    function clearProjectReservationEpochIfIdle(id: string): void {
        if (
            !host.hasPinnedReservation(id) &&
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
        for (const id of ids) {
            projectReservationEpochById.set(id, (projectReservationEpochById.get(id) ?? 0) + 1);
            transactions.abort(id, 'discard');
            transactions.abort(id, 'persistence');
            transactions.abort(id, 'reclamation');
        }
        for (const id of projectReservationEpochById.keys()) {
            clearProjectReservationEpochIfIdle(id);
        }
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
            host.hasPinnedReservation(id) ||
            projectReservationEpochById.get(id) !== admittedReservationEpoch
        );
    }

    function publishPreparedRuntime(
        id: string,
        leaseId: string,
        status: 'project-owned' | 'temporary',
        buffer: AudioBuffer,
        lastAccessed: number
    ): void {
        invalidateReopen(id);
        runtimeOwnerById.set(id, { kind: 'prepared', leaseId, status, token: nextToken() });
        host.publishRuntime(id, buffer, lastAccessed);
    }

    function evictPreparedRuntimeIfOwned(id: string, leaseId: string): void {
        const owner = runtimeOwnerById.get(id);
        if (owner?.kind !== 'prepared' || owner.leaseId !== leaseId || owner.status !== 'temporary') {
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

    async function restoreDiscardedPairIfVacant(
        id: string,
        data: PreparedSerializedAudioBuffer,
        metadata: PreparedAudioBufferMetadata
    ): Promise<void> {
        const database = await host.openDatabase();
        const transaction = database.transaction([host.bufferStoreName, host.metadataStoreName], 'readwrite');
        const tracked = transactions.track(id, 'reconciliation', transaction);
        try {
            const bufferStore = transaction.objectStore(host.bufferStoreName);
            const metadataStore = transaction.objectStore(host.metadataStoreName);
            const [currentData, currentMetadata] = await Promise.all([
                awaitPreparedRequest(bufferStore.get(id) as IDBRequest<PreparedSerializedAudioBuffer | undefined>),
                awaitPreparedRequest(metadataStore.get(id) as IDBRequest<PreparedAudioBufferMetadata | undefined>),
            ]);
            if (currentData === undefined && currentMetadata === undefined) {
                bufferStore.put(data, id);
                metadataStore.put(metadata, id);
            }
            await awaitPreparedTransaction(transaction);
        } finally {
            transactions.untrack(id, tracked);
        }
    }

    async function persist({ buffer, data, id, leaseId }: PersistPreparedAudioBufferInput) {
        const invalidIdentity = preparedIdentityFailure(id, leaseId);
        if (invalidIdentity) {
            return { status: 'failed' as const, reason: invalidIdentity };
        }
        if (host.hasPinnedReservation(id)) {
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
        let reconciledOwnerStatus: PreparedAudioBufferOwner['status'] | undefined;
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
            if (host.hasPinnedReservation(id) || projectReservationEpochById.get(id) !== admittedReservationEpoch) {
                await abortPreparedTransaction(transaction);
            }
            const existingOwner = readPreparedOwner(existingMetadata);
            const retryingExactLease =
                existingOwner !== 'invalid' &&
                existingOwner?.status === 'temporary' &&
                existingOwner.leaseId === leaseId;
            if (retryingExactLease) {
                if (!isValidPreparedAudioBufferPair(existingData, existingMetadata)) {
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
                if (existingOwner.persistenceRevision === undefined) {
                    metadataStore.put(
                        {
                            ...existingMetadata,
                            preparedOwner: { ...existingOwner, persistenceRevision },
                        } satisfies PreparedAudioBufferMetadata,
                        id
                    );
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
            if (host.hasPinnedReservation(id) || projectReservationEpochById.get(id) !== admittedReservationEpoch) {
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
            }
            const currentOwner = runtimeOwnerById.get(id);
            if (
                projectEpoch === admittedProjectEpoch &&
                ((currentOwner?.token === admittedToken && isRuntimeSlotAvailableForPersist(id, leaseId)) ||
                    (reconciledOwnerStatus !== undefined && currentOwner === undefined && !host.hasRuntime(id)))
            ) {
                publishPreparedRuntime(id, leaseId, reconciledOwnerStatus ?? 'temporary', buffer, data.lastAccessed);
            }
            return { status: 'persisted' as const, bufferId: id, leaseId };
        } catch (error) {
            if (host.hasPinnedReservation(id) || projectReservationEpochById.get(id) !== admittedReservationEpoch) {
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
        if (!isRuntimeSlotAvailable(id, leaseId)) {
            return { status: 'failed' as const, reason: 'Prepared audio buffer ID is already occupied.' };
        }
        transactions.abort(id, 'reclamation');
        const admittedOwner = runtimeOwnerById.get(id);
        const admittedToken = admittedOwner?.token;
        const admittedProjectEpoch = projectEpoch;
        const reopenToken = ++nextReopenToken;
        activeReopenTokenById.set(id, reopenToken);
        try {
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
            publishPreparedRuntime(id, leaseId, owner.status, buffer, metadata.lastAccessed);
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
        if (disposition === 'discard' && host.hasPinnedReservation(id)) {
            return { status: 'failed' as const, reason: 'Prepared audio buffer ID is reserved by the project.' };
        }
        if (disposition === 'discard') {
            beginDiscardAttempt(id);
        }
        const admittedProjectEpoch = projectEpoch;
        const admittedReservationEpoch = projectReservationEpochById.get(id);
        const admittedRuntimeToken = runtimeOwnerById.get(id)?.token;
        const promotionRevision = crypto.randomUUID();
        const promotionSettlement = disposition === 'project-owned' ? beginPromotionSettlement(id) : undefined;
        let generation = persistenceAttempts.isLeaseActive(id, leaseId) ? host.claimDurableMutation(id) : undefined;
        let discardedData: PreparedSerializedAudioBuffer | undefined;
        let discardedMetadata: PreparedAudioBufferMetadata | undefined;
        let discardCommitted = false;
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
            const transaction = database.transaction([host.bufferStoreName, host.metadataStoreName], 'readwrite');
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
            if (
                (disposition === 'project-owned' || owner.status === 'project-owned') &&
                !isValidPreparedAudioBufferPair(data, metadata)
            ) {
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
                if (!isPromotionCurrent(id, leaseId, admittedProjectEpoch, admittedRuntimeToken)) {
                    await rollbackPromotionIfExact(id, leaseId, promotionRevision);
                    return { status: 'failed' as const, reason: 'Prepared audio promotion was superseded.' };
                }
                const runtimeOwner = runtimeOwnerById.get(id);
                if (runtimeOwner?.kind === 'prepared' && runtimeOwner.leaseId === leaseId) {
                    runtimeOwnerById.set(id, {
                        kind: 'prepared',
                        leaseId,
                        status: 'project-owned',
                        token: nextToken(),
                    });
                }
                return { status: 'released' as const, disposition: 'project-owned' as const };
            }
            discardedData = data;
            discardedMetadata = metadata;
            bufferStore.delete(id);
            metadataStore.delete(id);
            await awaitPreparedTransaction(transaction);
            discardCommitted = true;
            if (isDiscardSuperseded(id, admittedProjectEpoch, admittedReservationEpoch)) {
                await restoreDiscardedPairIfVacant(id, data, metadata);
                return { status: 'failed' as const, reason: 'Prepared audio buffer ID is reserved by the project.' };
            }
            evictPreparedRuntimeIfOwned(id, leaseId);
            return { status: 'released' as const, disposition: 'discarded' as const };
        } catch (error) {
            if (disposition === 'discard' && isDiscardSuperseded(id, admittedProjectEpoch, admittedReservationEpoch)) {
                if (discardCommitted && discardedData !== undefined && discardedMetadata !== undefined) {
                    try {
                        await restoreDiscardedPairIfVacant(id, discardedData, discardedMetadata);
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

    async function reclaimOrphans({ createdBeforeMs, liveLeaseIds }: ReclaimPreparedAudioBufferOrphansInput) {
        if (!Number.isFinite(createdBeforeMs)) {
            return { status: 'failed' as const, reason: 'Prepared audio orphan cutoff is invalid.' };
        }
        const liveLeases = new Set(liveLeaseIds);
        const trackedTransactions: Array<{ id: string; tracked: PreparedTransaction }> = [];
        try {
            const database = await host.openDatabase();
            const transaction = database.transaction([host.bufferStoreName, host.metadataStoreName], 'readwrite');
            const bufferStore = transaction.objectStore(host.bufferStoreName);
            const metadataStore = transaction.objectStore(host.metadataStoreName);
            const [metadataRows, keys] = await Promise.all([
                awaitPreparedRequest(metadataStore.getAll() as IDBRequest<PreparedAudioBufferMetadata[]>),
                awaitPreparedRequest(metadataStore.getAllKeys()),
            ]);
            const reclaimed: Array<{ id: string; leaseId: string }> = [];
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
                    host.hasPinnedReservation(id) ||
                    runtimeOwnerById.has(id)
                ) {
                    continue;
                }
                trackedTransactions.push({
                    id,
                    tracked: transactions.track(id, 'reclamation', transaction),
                });
                bufferStore.delete(id);
                metadataStore.delete(id);
                reclaimed.push({ id, leaseId: owner.leaseId });
            }
            await awaitPreparedTransaction(transaction);
            for (const { id, leaseId } of reclaimed) {
                evictPreparedRuntimeIfOwned(id, leaseId);
            }
            return { status: 'reclaimed' as const, count: reclaimed.length };
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
        captureTemporaryPublications,
        evictCapturedTemporaryPublication,
        persist,
        readPreparedOwner,
        reclaimOrphans,
        recordOrdinaryRuntimeMutation,
        recordProjectReservations,
        recordRuntimeVacated,
        release,
        reopen,
        shouldSuppressNonLeaseRead,
    };
}
