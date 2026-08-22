export type PreparedAudioBufferOwner = {
    schemaVersion: 1;
    createdAtMs?: number;
    leaseId: string;
    status: 'project-owned' | 'temporary';
};

export type PreparedAudioBufferMetadata = {
    freezeProjectId?: number;
    lastAccessed: number;
    preparedOwner?: PreparedAudioBufferOwner;
    sizeInBytes: number;
};

export type PreparedSerializedAudioBuffer = {
    sampleRate: number;
    numberOfChannels: number;
    channelData: Float32Array[];
    lastAccessed: number;
    sizeInBytes: number;
};

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

type PreparedPersistenceAttempt = {
    generation: number;
    settled: Promise<void>;
    settle: () => void;
};

type PreparedTransactionRole = 'persistence' | 'promotion' | 'reconciliation';

type PreparedTransaction = {
    role: PreparedTransactionRole;
    transaction: IDBTransaction;
};

function awaitRequest<Result>(request: IDBRequest<Result>): Promise<Result> {
    return new Promise<Result>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('IDB request failed'));
    });
}

function awaitTransaction(transaction: IDBTransaction): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error ?? new Error('IDB transaction aborted'));
        transaction.onerror = () => reject(transaction.error ?? new Error('IDB transaction failed'));
    });
}

function abortAndAwaitTransaction(transaction: IDBTransaction): Promise<void> {
    const settled = awaitTransaction(transaction);
    transaction.abort();
    return settled;
}

function failureReason(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function preparedIdentityFailure(id: string, leaseId: string): string | undefined {
    if (id.trim().length === 0) {
        return 'Prepared audio buffer ID is invalid.';
    }
    if (leaseId.trim().length === 0) {
        return 'Prepared audio lease ID is invalid.';
    }
    return undefined;
}

function readPreparedOwner(
    metadata: PreparedAudioBufferMetadata | undefined
): PreparedAudioBufferOwner | null | 'invalid' {
    const owner = metadata?.preparedOwner;
    if (owner === undefined) {
        return null;
    }
    if (
        owner === null ||
        typeof owner !== 'object' ||
        owner.schemaVersion !== 1 ||
        typeof owner.leaseId !== 'string' ||
        owner.leaseId.length === 0 ||
        (owner.createdAtMs !== undefined && !Number.isFinite(owner.createdAtMs)) ||
        (owner.status !== 'temporary' && owner.status !== 'project-owned')
    ) {
        return 'invalid';
    }
    return owner;
}

function serializedBuffersEqual(alpha: PreparedSerializedAudioBuffer, beta: PreparedSerializedAudioBuffer): boolean {
    return (
        alpha.sampleRate === beta.sampleRate &&
        alpha.numberOfChannels === beta.numberOfChannels &&
        alpha.sizeInBytes === beta.sizeInBytes &&
        alpha.channelData.length === beta.channelData.length &&
        alpha.channelData.every((channel, channelIndex) => {
            const other = beta.channelData[channelIndex];
            return (
                other !== undefined &&
                channel.length === other.length &&
                channel.every((sample, sampleIndex) => sample === other[sampleIndex])
            );
        })
    );
}

/**
 * Owns the prepared-PCM state machine across IndexedDB and the synchronous
 * playback cache. The host exposes ordinary cache mechanics; only this
 * coordinator may classify a prepared row or publish, promote, discard, and
 * reclaim its lease.
 */
export function createPreparedAudioBufferLifecycle(host: PreparedAudioBufferLifecycleHost) {
    let nextRuntimeToken = 0;
    let projectEpoch = 0;
    const runtimeOwnerById = new Map<string, RuntimeOwner>();
    const activeLeaseCountsById = new Map<string, Map<string, number>>();
    const persistenceAttemptById = new Map<string, PreparedPersistenceAttempt>();
    const activeTransactionsById = new Map<string, Set<PreparedTransaction>>();
    const projectReservationEpochById = new Map<string, number>();

    function nextToken(): number {
        return ++nextRuntimeToken;
    }

    function trackTransaction(
        id: string,
        role: PreparedTransactionRole,
        transaction: IDBTransaction
    ): PreparedTransaction {
        const tracked = { role, transaction };
        const transactions = activeTransactionsById.get(id) ?? new Set<PreparedTransaction>();
        transactions.add(tracked);
        activeTransactionsById.set(id, transactions);
        return tracked;
    }

    function untrackTransaction(id: string, tracked: PreparedTransaction | undefined): void {
        if (!tracked) {
            return;
        }
        const transactions = activeTransactionsById.get(id);
        transactions?.delete(tracked);
        if (transactions?.size === 0) {
            activeTransactionsById.delete(id);
        }
    }

    function abortTransactions(id: string, role: PreparedTransactionRole): void {
        for (const tracked of activeTransactionsById.get(id) ?? []) {
            if (tracked.role !== role) {
                continue;
            }
            try {
                tracked.transaction.abort();
            } catch {
                // The exact transaction committed before invalidation reached it.
            }
        }
    }

    function recordOrdinaryRuntimeMutation(id: string): void {
        runtimeOwnerById.set(id, { kind: 'ordinary', token: nextToken() });
        abortTransactions(id, 'promotion');
    }

    function recordRuntimeVacated(id: string): void {
        runtimeOwnerById.delete(id);
        nextToken();
    }

    function beginProjectTransition(retainedIds?: ReadonlySet<string>): void {
        projectEpoch++;
        for (const id of activeTransactionsById.keys()) {
            abortTransactions(id, 'promotion');
        }
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
            abortTransactions(id, 'persistence');
        }
        for (const id of projectReservationEpochById.keys()) {
            if (!host.hasPinnedReservation(id) && !activeLeaseCountsById.has(id)) {
                projectReservationEpochById.delete(id);
            }
        }
    }

    function registerPersistenceAttempt(id: string, generation: number, leaseId: string): PreparedPersistenceAttempt {
        let settle = (): void => undefined;
        const settled = new Promise<void>((resolve) => {
            settle = resolve;
        });
        const attempt = { generation, settled, settle };
        persistenceAttemptById.set(id, attempt);
        const leaseCounts = activeLeaseCountsById.get(id) ?? new Map<string, number>();
        leaseCounts.set(leaseId, (leaseCounts.get(leaseId) ?? 0) + 1);
        activeLeaseCountsById.set(id, leaseCounts);
        return attempt;
    }

    function unregisterPersistenceAttempt(id: string, leaseId: string, attempt: PreparedPersistenceAttempt): void {
        attempt.settle();
        if (persistenceAttemptById.get(id) === attempt) {
            persistenceAttemptById.delete(id);
        }
        const leaseCounts = activeLeaseCountsById.get(id);
        const remainingForLease = (leaseCounts?.get(leaseId) ?? 1) - 1;
        if (remainingForLease > 0) {
            leaseCounts?.set(leaseId, remainingForLease);
        } else {
            leaseCounts?.delete(leaseId);
        }
        if (leaseCounts?.size === 0) {
            activeLeaseCountsById.delete(id);
            if (!host.hasPinnedReservation(id)) {
                projectReservationEpochById.delete(id);
            }
        }
    }

    function isLeaseActive(id: string, leaseId: string): boolean {
        return (activeLeaseCountsById.get(id)?.get(leaseId) ?? 0) > 0;
    }

    async function waitForSupersedingPersistence(id: string, generation: number): Promise<void> {
        for (;;) {
            const attempt = persistenceAttemptById.get(id);
            if (!attempt || attempt.generation <= generation) {
                return;
            }
            await attempt.settled;
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
        if (!host.hasRuntime(id) && owner?.kind === 'reservation' && isLeaseActive(id, owner.leaseId)) {
            return true;
        }
        return (
            owner?.kind === 'prepared' &&
            owner.status === 'temporary' &&
            (owner.reservationLeaseId === leaseId || isLeaseActive(id, owner.leaseId))
        );
    }

    function isPromotionCurrent(id: string, leaseId: string, admittedEpoch: number, admittedToken?: number): boolean {
        return (
            projectEpoch === admittedEpoch &&
            runtimeOwnerById.get(id)?.token === admittedToken &&
            isRuntimeSlotAvailable(id, leaseId)
        );
    }

    function publishPreparedRuntime(
        id: string,
        leaseId: string,
        status: 'project-owned' | 'temporary',
        buffer: AudioBuffer,
        lastAccessed: number
    ): void {
        runtimeOwnerById.set(id, { kind: 'prepared', leaseId, status, token: nextToken() });
        host.publishRuntime(id, buffer, lastAccessed);
    }

    function evictPreparedRuntimeIfOwned(id: string, leaseId: string): void {
        const owner = runtimeOwnerById.get(id);
        if (owner?.kind !== 'prepared' || owner.leaseId !== leaseId || owner.status !== 'temporary') {
            return;
        }
        runtimeOwnerById.delete(id);
        nextToken();
        host.evictRuntime(id);
    }

    async function readDurableOwner(id: string): Promise<PreparedAudioBufferOwner | null | 'invalid'> {
        const database = await host.openDatabase();
        const transaction = database.transaction(host.metadataStoreName, 'readonly');
        const metadata = await awaitRequest(
            transaction.objectStore(host.metadataStoreName).get(id) as IDBRequest<
                PreparedAudioBufferMetadata | undefined
            >
        );
        await awaitTransaction(transaction);
        return readPreparedOwner(metadata);
    }

    async function discardTemporaryLeaseIfExact(id: string, leaseId: string): Promise<void> {
        const database = await host.openDatabase();
        const transaction = database.transaction([host.bufferStoreName, host.metadataStoreName], 'readwrite');
        const tracked = trackTransaction(id, 'reconciliation', transaction);
        try {
            const metadataStore = transaction.objectStore(host.metadataStoreName);
            const metadata = await awaitRequest(
                metadataStore.get(id) as IDBRequest<PreparedAudioBufferMetadata | undefined>
            );
            const owner = readPreparedOwner(metadata);
            if (owner !== 'invalid' && owner?.status === 'temporary' && owner.leaseId === leaseId) {
                transaction.objectStore(host.bufferStoreName).delete(id);
                metadataStore.delete(id);
            }
            await awaitTransaction(transaction);
        } finally {
            untrackTransaction(id, tracked);
        }
    }

    async function rollbackPromotionIfExact(id: string, leaseId: string): Promise<void> {
        const database = await host.openDatabase();
        const transaction = database.transaction(host.metadataStoreName, 'readwrite');
        const tracked = trackTransaction(id, 'reconciliation', transaction);
        try {
            const metadataStore = transaction.objectStore(host.metadataStoreName);
            const metadata = await awaitRequest(
                metadataStore.get(id) as IDBRequest<PreparedAudioBufferMetadata | undefined>
            );
            const owner = readPreparedOwner(metadata);
            if (owner !== 'invalid' && owner?.status === 'project-owned' && owner.leaseId === leaseId) {
                metadataStore.put(
                    {
                        ...metadata,
                        preparedOwner: { ...owner, status: 'temporary' },
                    } satisfies PreparedAudioBufferMetadata,
                    id
                );
            }
            await awaitTransaction(transaction);
        } finally {
            untrackTransaction(id, tracked);
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
        const attempt = registerPersistenceAttempt(id, generation, leaseId);
        let reconciledOwnerStatus: PreparedAudioBufferOwner['status'] | undefined;
        let trackedTransaction: PreparedTransaction | undefined;
        let wroteTemporaryRow = false;
        try {
            const database = await host.openDatabase();
            if (!host.isDurableMutationCurrent(id, generation)) {
                return { status: 'failed' as const, reason: 'Prepared audio persistence was superseded.' };
            }
            const transaction = database.transaction([host.bufferStoreName, host.metadataStoreName], 'readwrite');
            trackedTransaction = trackTransaction(id, 'persistence', transaction);
            const bufferStore = transaction.objectStore(host.bufferStoreName);
            const metadataStore = transaction.objectStore(host.metadataStoreName);
            const [existingData, existingMetadata] = await Promise.all([
                awaitRequest(bufferStore.get(id) as IDBRequest<PreparedSerializedAudioBuffer | undefined>),
                awaitRequest(metadataStore.get(id) as IDBRequest<PreparedAudioBufferMetadata | undefined>),
            ]);
            if (host.hasPinnedReservation(id) || projectReservationEpochById.get(id) !== admittedReservationEpoch) {
                await abortAndAwaitTransaction(transaction);
            }
            const existingOwner = readPreparedOwner(existingMetadata);
            const retryingExactLease =
                existingOwner !== 'invalid' &&
                existingOwner?.status === 'temporary' &&
                existingOwner.leaseId === leaseId;
            if (retryingExactLease) {
                if (!host.isValidSerializedBuffer(existingData) || !serializedBuffersEqual(existingData, data)) {
                    await awaitTransaction(transaction);
                    return {
                        status: 'failed' as const,
                        reason: 'Prepared audio retry does not match its durable PCM.',
                    };
                }
                await awaitTransaction(transaction);
            } else {
                const occupied = existingData !== undefined || existingMetadata !== undefined;
                const replaceableActiveOwner =
                    existingOwner !== 'invalid' &&
                    existingOwner?.status === 'temporary' &&
                    (isLeaseActive(id, existingOwner.leaseId) ||
                        (admittedOwner?.kind === 'prepared' &&
                            admittedOwner.status === 'temporary' &&
                            admittedOwner.leaseId === existingOwner.leaseId));
                if (!isRuntimeSlotAvailableForPersist(id, leaseId) || (occupied && !replaceableActiveOwner)) {
                    await awaitTransaction(transaction);
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
                            status: 'temporary',
                        },
                        sizeInBytes: data.sizeInBytes,
                    } satisfies PreparedAudioBufferMetadata,
                    id
                );
                wroteTemporaryRow = true;
                await awaitTransaction(transaction);
            }
            if (host.hasPinnedReservation(id) || projectReservationEpochById.get(id) !== admittedReservationEpoch) {
                if (wroteTemporaryRow) {
                    await discardTemporaryLeaseIfExact(id, leaseId);
                }
                return { status: 'failed' as const, reason: 'Prepared audio buffer ID is reserved by the project.' };
            }
            if (!host.isDurableMutationCurrent(id, generation)) {
                await waitForSupersedingPersistence(id, generation);
                const owner = await readDurableOwner(id);
                if (owner === 'invalid' || owner?.leaseId !== leaseId) {
                    return { status: 'failed' as const, reason: 'Prepared audio persistence was superseded.' };
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
            untrackTransaction(id, trackedTransaction);
            const runtimeOwner = runtimeOwnerById.get(id);
            if (runtimeOwner?.kind === 'prepared' && runtimeOwner.reservationLeaseId === leaseId) {
                runtimeOwnerById.set(id, {
                    kind: 'prepared',
                    leaseId: runtimeOwner.leaseId,
                    status: runtimeOwner.status,
                    token: runtimeOwner.token,
                });
            } else if (runtimeOwner?.kind === 'reservation' && runtimeOwner.leaseId === leaseId) {
                runtimeOwnerById.delete(id);
            }
            unregisterPersistenceAttempt(id, leaseId, attempt);
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
        const admittedOwner = runtimeOwnerById.get(id);
        const admittedToken = admittedOwner?.token;
        const admittedProjectEpoch = projectEpoch;
        try {
            const database = await host.openDatabase();
            const transaction = database.transaction([host.bufferStoreName, host.metadataStoreName], 'readonly');
            const [data, metadata] = await Promise.all([
                awaitRequest(
                    transaction.objectStore(host.bufferStoreName).get(id) as IDBRequest<
                        PreparedSerializedAudioBuffer | undefined
                    >
                ),
                awaitRequest(
                    transaction.objectStore(host.metadataStoreName).get(id) as IDBRequest<
                        PreparedAudioBufferMetadata | undefined
                    >
                ),
            ]);
            await awaitTransaction(transaction);
            const currentOwner = runtimeOwnerById.get(id);
            if (projectEpoch !== admittedProjectEpoch || currentOwner?.token !== admittedToken) {
                return { status: 'failed' as const, reason: 'Prepared audio reopen was superseded.' };
            }
            if (!data || !metadata) {
                return { status: 'missing' as const };
            }
            const owner = readPreparedOwner(metadata);
            if (owner === 'invalid') {
                return { status: 'failed' as const, reason: 'Prepared audio ownership metadata is invalid.' };
            }
            if (!owner || owner.leaseId !== leaseId) {
                return { status: 'mismatched' as const };
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
            const length = data.channelData[0]!.length;
            const buffer = context.createBuffer(data.numberOfChannels, length, data.sampleRate);
            for (let channel = 0; channel < data.numberOfChannels; channel++) {
                buffer.getChannelData(channel).set(data.channelData[channel]!);
            }
            publishPreparedRuntime(id, leaseId, owner.status, buffer, metadata.lastAccessed);
            return { status: 'reopened' as const, bufferId: id, ownership: owner.status };
        } catch (error) {
            return { status: 'failed' as const, reason: failureReason(error) };
        }
    }

    async function release({ disposition, id, leaseId }: ReleasePreparedAudioBufferInput) {
        const invalidIdentity = preparedIdentityFailure(id, leaseId);
        if (invalidIdentity) {
            return { status: 'failed' as const, reason: invalidIdentity };
        }
        const admittedProjectEpoch = projectEpoch;
        const admittedRuntimeToken = runtimeOwnerById.get(id)?.token;
        const generation = host.claimDurableMutation(id);
        let promotionCommitted = false;
        let trackedTransaction: PreparedTransaction | undefined;
        try {
            if (disposition === 'project-owned' && !isRuntimeSlotAvailable(id, leaseId)) {
                return { status: 'failed' as const, reason: 'Prepared audio buffer ID is already occupied.' };
            }
            const database = await host.openDatabase();
            if (!host.isDurableMutationCurrent(id, generation)) {
                return { status: 'failed' as const, reason: 'Prepared audio settlement was superseded.' };
            }
            const transaction = database.transaction([host.bufferStoreName, host.metadataStoreName], 'readwrite');
            if (disposition === 'project-owned') {
                trackedTransaction = trackTransaction(id, 'promotion', transaction);
            }
            const bufferStore = transaction.objectStore(host.bufferStoreName);
            const metadataStore = transaction.objectStore(host.metadataStoreName);
            const [data, metadata] = await Promise.all([
                awaitRequest(bufferStore.get(id) as IDBRequest<PreparedSerializedAudioBuffer | undefined>),
                awaitRequest(metadataStore.get(id) as IDBRequest<PreparedAudioBufferMetadata | undefined>),
            ]);
            if (!data || !metadata) {
                await awaitTransaction(transaction);
                if (!data && !metadata) {
                    evictPreparedRuntimeIfOwned(id, leaseId);
                }
                return { status: 'missing' as const };
            }
            const owner = readPreparedOwner(metadata);
            if (owner === 'invalid') {
                await awaitTransaction(transaction);
                return { status: 'failed' as const, reason: 'Prepared audio ownership metadata is invalid.' };
            }
            if (!owner || owner.leaseId !== leaseId) {
                await awaitTransaction(transaction);
                return { status: 'mismatched' as const };
            }
            if (owner.status === 'project-owned') {
                await awaitTransaction(transaction);
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
                    await abortAndAwaitTransaction(transaction);
                }
                if (!host.isValidSerializedBuffer(data) || metadata.sizeInBytes !== data.sizeInBytes) {
                    await awaitTransaction(transaction);
                    return { status: 'failed' as const, reason: 'Prepared audio PCM cannot be promoted safely.' };
                }
                metadataStore.put(
                    {
                        ...metadata,
                        preparedOwner: { ...owner, status: 'project-owned' },
                    } satisfies PreparedAudioBufferMetadata,
                    id
                );
                await awaitTransaction(transaction);
                promotionCommitted = true;
                if (!isPromotionCurrent(id, leaseId, admittedProjectEpoch, admittedRuntimeToken)) {
                    await rollbackPromotionIfExact(id, leaseId);
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
            bufferStore.delete(id);
            metadataStore.delete(id);
            await awaitTransaction(transaction);
            evictPreparedRuntimeIfOwned(id, leaseId);
            return { status: 'released' as const, disposition: 'discarded' as const };
        } catch (error) {
            if (
                disposition === 'project-owned' &&
                !isPromotionCurrent(id, leaseId, admittedProjectEpoch, admittedRuntimeToken)
            ) {
                if (promotionCommitted) {
                    try {
                        await rollbackPromotionIfExact(id, leaseId);
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
            untrackTransaction(id, trackedTransaction);
            host.finishDurableMutation(id, generation);
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

    function evictCapturedTemporaryPublication(id: string, capture: TemporaryPublicationSnapshot): void {
        const owner = runtimeOwnerById.get(id);
        if (
            projectEpoch !== capture.projectEpoch ||
            owner?.kind !== 'prepared' ||
            owner.status !== 'temporary' ||
            owner.leaseId !== capture.leaseId ||
            owner.token !== capture.token
        ) {
            return;
        }
        evictPreparedRuntimeIfOwned(id, capture.leaseId);
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
            if (runtimeOwner?.kind === 'ordinary' || runtimeOwner?.status === 'project-owned') {
                return false;
            }
            if (runtimeOwner?.kind === 'prepared' && runtimeOwner.status === 'temporary') {
                return true;
            }
        }
        return durableOwner?.status === 'temporary';
    }

    async function reclaimOrphans({ createdBeforeMs, liveLeaseIds }: ReclaimPreparedAudioBufferOrphansInput) {
        const liveLeases = new Set(liveLeaseIds);
        try {
            const database = await host.openDatabase();
            const transaction = database.transaction([host.bufferStoreName, host.metadataStoreName], 'readwrite');
            const bufferStore = transaction.objectStore(host.bufferStoreName);
            const metadataStore = transaction.objectStore(host.metadataStoreName);
            const [metadataRows, keys] = await Promise.all([
                awaitRequest(metadataStore.getAll() as IDBRequest<PreparedAudioBufferMetadata[]>),
                awaitRequest(metadataStore.getAllKeys()),
            ]);
            const reclaimed: Array<{ id: string; leaseId: string }> = [];
            for (let index = 0; index < keys.length; index++) {
                const id = keys[index];
                const owner = readPreparedOwner(metadataRows[index]);
                if (
                    typeof id !== 'string' ||
                    owner === 'invalid' ||
                    owner?.status !== 'temporary' ||
                    owner.createdAtMs === undefined ||
                    owner.createdAtMs >= createdBeforeMs ||
                    liveLeases.has(owner.leaseId) ||
                    host.hasPinnedReservation(id) ||
                    runtimeOwnerById.has(id)
                ) {
                    continue;
                }
                bufferStore.delete(id);
                metadataStore.delete(id);
                reclaimed.push({ id, leaseId: owner.leaseId });
            }
            await awaitTransaction(transaction);
            for (const { id, leaseId } of reclaimed) {
                evictPreparedRuntimeIfOwned(id, leaseId);
            }
            return { status: 'reclaimed' as const, count: reclaimed.length };
        } catch (error) {
            return { status: 'failed' as const, reason: failureReason(error) };
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
