import {
    canonicalAudioBufferIds,
    checkpointAudioVersionKey,
    CHECKPOINT_AUDIO_VERSION_META_STORE_NAME,
    CHECKPOINT_AUDIO_VERSION_STORE_NAME,
    CHECKPOINT_RETENTION_STORE_NAME,
    isNonEmptyAudioStorageId,
    readCheckpointAudioRetention,
    readCheckpointAudioVersion,
    readCheckpointAudioVersionKey,
    readCheckpointAudioVersionMetadata,
    type CheckpointAudioRetention,
    type CheckpointAudioVersionMetadata,
} from '../models/checkpointAudioRetention';
import {
    isValidPreparedSerializedAudioBuffer,
    readPersistentPcmRevision,
    readPreparedOwner,
    requiresPromotionReconciliation,
    type PreparedAudioBufferMetadata,
} from '../stores/preparedAudioBufferOwnership';

import type { SerializedAudioBuffer } from '../models/serializedAudioBuffer';

const BUFFER_STORE_NAME = 'buffers';
const META_STORE_NAME = 'bufferMeta';

type CheckpointRetentionAuthority = {
    bufferIds: readonly string[];
    expectedPersistenceRevisionById: ReadonlyMap<string, string>;
    isCurrent: () => boolean;
};

type RepositoryDependencies = {
    openDatabase: () => Promise<IDBDatabase>;
};

type AcquireInput = {
    checkpointId: string;
    projectOwnerId: string;
    authority: CheckpointRetentionAuthority;
};

type ReadInput = {
    checkpointId: string;
    projectOwnerId: string;
    ownershipToken: string;
    expectedBufferIds: readonly string[];
    audioContext: Pick<BaseAudioContext, 'createBuffer'>;
};

type ReleaseInput = {
    checkpointId: string;
    projectOwnerId: string;
    ownershipToken: string;
};

type OrdinaryPair = {
    data: SerializedAudioBuffer & { lastAccessed: number };
    metadata: PreparedAudioBufferMetadata;
    persistenceRevision: string;
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
    });
}

async function awaitRequests<Result>(request: Promise<Result>, settlement: Promise<void>): Promise<Result> {
    try {
        return await request;
    } catch (error) {
        await settlement.catch(() => undefined);
        throw error;
    }
}

async function settleThenThrow(settlement: Promise<void>, error: unknown): Promise<never> {
    await settlement.catch(() => undefined);
    throw error;
}

async function abortThenThrow(
    transaction: IDBTransaction,
    transactionSettlement: Promise<void>,
    error: unknown
): Promise<never> {
    try {
        transaction.abort();
    } catch {
        // The transaction has already reached its terminal state.
    }
    return settleThenThrow(transactionSettlement, error);
}

function readOrdinaryPair(data: unknown, metadata: unknown): OrdinaryPair | null {
    if (
        !isValidPreparedSerializedAudioBuffer(data) ||
        metadata === null ||
        typeof metadata !== 'object' ||
        Array.isArray(metadata)
    ) {
        return null;
    }
    const candidate = metadata as Record<string, unknown>;
    if (
        typeof candidate.lastAccessed !== 'number' ||
        !Number.isFinite(candidate.lastAccessed) ||
        candidate.sizeInBytes !== data.sizeInBytes ||
        (candidate.freezeProjectId !== undefined &&
            (typeof candidate.freezeProjectId !== 'number' ||
                !Number.isSafeInteger(candidate.freezeProjectId) ||
                candidate.freezeProjectId < 0))
    ) {
        return null;
    }
    const owner = readPreparedOwner(metadata);
    if (!(
        owner === null ||
        (owner !== 'invalid' && owner.status === 'project-owned' && !requiresPromotionReconciliation(owner))
    )) {
        return null;
    }
    const persistenceRevision = readPersistentPcmRevision(metadata);
    if (persistenceRevision === null) {
        return null;
    }
    return { data, metadata: metadata as PreparedAudioBufferMetadata, persistenceRevision };
}

function immutableVersionFromOrdinary(pair: OrdinaryPair): SerializedAudioBuffer {
    return {
        sampleRate: pair.data.sampleRate,
        numberOfChannels: pair.data.numberOfChannels,
        channelData: pair.data.channelData,
        sizeInBytes: pair.data.sizeInBytes,
    };
}

function retentionBufferIds(retention: CheckpointAudioRetention): string[] {
    return retention.versionKeys.map((versionKey) => readCheckpointAudioVersionKey(versionKey)![0]).toSorted();
}

function retentionsFromRows(values: unknown[], keys: IDBValidKey[]): CheckpointAudioRetention[] {
    if (values.length !== keys.length) {
        throw new Error('Checkpoint audio retention ownership is unreadable.');
    }
    return values.map((value, index) => {
        const retention = readCheckpointAudioRetention(value, keys[index]!);
        if (retention === null) {
            throw new Error('Checkpoint audio retention ownership is invalid.');
        }
        return retention;
    });
}

function assertVersionPair(
    versionKey: string,
    data: unknown,
    metadata: unknown
): { data: SerializedAudioBuffer; metadata: CheckpointAudioVersionMetadata } {
    const validMetadata = readCheckpointAudioVersionMetadata(metadata, versionKey);
    if (validMetadata === null) {
        throw new Error(`Checkpoint audio version metadata is invalid for ${versionKey}.`);
    }
    const validData = readCheckpointAudioVersion(data, validMetadata);
    if (validData === null) {
        throw new Error(`Checkpoint audio version PCM is invalid for ${versionKey}.`);
    }
    return { data: validData, metadata: validMetadata };
}

function validateAuthority(authority: CheckpointRetentionAuthority): {
    bufferIds: string[];
    versionKeys: string[];
} {
    const bufferIds = canonicalAudioBufferIds(authority.bufferIds);
    const versionKeys = bufferIds.map((bufferId) => {
        const revision = authority.expectedPersistenceRevisionById.get(bufferId);
        if (!isNonEmptyAudioStorageId(revision)) {
            throw new Error(`Checkpoint audio retention is missing a persistence revision for ${bufferId}.`);
        }
        return checkpointAudioVersionKey(bufferId, revision);
    });
    return { bufferIds, versionKeys: versionKeys.toSorted() };
}

function assertRetentionIdentity(checkpointId: string, projectOwnerId: string): void {
    if (!isNonEmptyAudioStorageId(checkpointId) || !isNonEmptyAudioStorageId(projectOwnerId)) {
        throw new Error('Checkpoint audio retention requires checkpoint and project owner IDs.');
    }
}

function createAudioBuffer(
    audioContext: Pick<BaseAudioContext, 'createBuffer'>,
    serialized: SerializedAudioBuffer
): AudioBuffer {
    const runtime = audioContext.createBuffer(
        serialized.numberOfChannels,
        serialized.channelData[0]!.length,
        serialized.sampleRate
    );
    for (const [index, channel] of serialized.channelData.entries()) {
        runtime.copyToChannel(channel, index);
    }
    return runtime;
}

async function readAcquisitionRows(
    transaction: IDBTransaction,
    transactionSettlement: Promise<void>,
    checkpointId: string,
    bufferIds: readonly string[],
    versionKeys: readonly string[]
) {
    const bufferStore = transaction.objectStore(BUFFER_STORE_NAME);
    const metadataStore = transaction.objectStore(META_STORE_NAME);
    const retentionStore = transaction.objectStore(CHECKPOINT_RETENTION_STORE_NAME);
    const versionStore = transaction.objectStore(CHECKPOINT_AUDIO_VERSION_STORE_NAME);
    const versionMetadataStore = transaction.objectStore(CHECKPOINT_AUDIO_VERSION_META_STORE_NAME);
    const [existingRetention, ordinaryValues, existingVersions] = await awaitRequests(
        Promise.all([
            awaitRequest(retentionStore.get(checkpointId) as IDBRequest<unknown>),
            Promise.all(
                bufferIds.map((bufferId) =>
                    Promise.all([
                        awaitRequest(bufferStore.get(bufferId) as IDBRequest<unknown>),
                        awaitRequest(metadataStore.get(bufferId) as IDBRequest<unknown>),
                    ])
                )
            ),
            Promise.all(
                versionKeys.map((versionKey) =>
                    Promise.all([
                        awaitRequest(versionStore.get(versionKey) as IDBRequest<unknown>),
                        awaitRequest(versionMetadataStore.get(versionKey) as IDBRequest<unknown>),
                    ])
                )
            ),
        ]),
        transactionSettlement
    );
    return {
        existingRetention,
        ordinaryValues,
        existingVersions,
        retentionStore,
        versionStore,
        versionMetadataStore,
    };
}

function queueAcquisitionWrites({
    checkpointId,
    projectOwnerId,
    ownershipToken,
    bufferIds,
    versionKeys,
    ordinaryPairs,
    existingVersions,
    retentionStore,
    versionStore,
    versionMetadataStore,
}: {
    checkpointId: string;
    projectOwnerId: string;
    ownershipToken: string;
    bufferIds: readonly string[];
    versionKeys: readonly string[];
    ordinaryPairs: readonly OrdinaryPair[];
    existingVersions: readonly (readonly [unknown, unknown])[];
    retentionStore: IDBObjectStore;
    versionStore: IDBObjectStore;
    versionMetadataStore: IDBObjectStore;
}): void {
    for (let index = 0; index < versionKeys.length; index++) {
        const versionKey = versionKeys[index]!;
        const [existingData, existingMetadata] = existingVersions[index]!;
        if (existingData !== undefined && existingMetadata !== undefined) {
            continue;
        }
        const identity = readCheckpointAudioVersionKey(versionKey)!;
        const ordinaryPair = ordinaryPairs[bufferIds.indexOf(identity[0])]!;
        const immutableVersion = immutableVersionFromOrdinary(ordinaryPair);
        versionStore.put(immutableVersion, versionKey);
        versionMetadataStore.put(
            {
                schemaVersion: 1,
                versionKey,
                bufferId: identity[0],
                persistenceRevision: identity[1],
                sizeInBytes: immutableVersion.sizeInBytes,
            } satisfies CheckpointAudioVersionMetadata,
            versionKey
        );
    }
    retentionStore.put(
        {
            schemaVersion: 2,
            checkpointId,
            projectOwnerId,
            ownershipToken,
            versionKeys: [...versionKeys],
        } satisfies CheckpointAudioRetention,
        checkpointId
    );
}

async function acquire(
    openDatabase: RepositoryDependencies['openDatabase'],
    { checkpointId, projectOwnerId, authority }: AcquireInput
) {
    assertRetentionIdentity(checkpointId, projectOwnerId);
    const { bufferIds, versionKeys } = validateAuthority(authority);
    if (!authority.isCurrent()) {
        return { status: 'superseded' as const };
    }
    const database = await openDatabase();
    if (!authority.isCurrent()) {
        return { status: 'superseded' as const };
    }
    const transaction = database.transaction(
        [
            BUFFER_STORE_NAME,
            META_STORE_NAME,
            CHECKPOINT_RETENTION_STORE_NAME,
            CHECKPOINT_AUDIO_VERSION_STORE_NAME,
            CHECKPOINT_AUDIO_VERSION_META_STORE_NAME,
        ],
        'readwrite'
    );
    const transactionSettlement = awaitTransaction(transaction);
    const { existingRetention, ordinaryValues, existingVersions, retentionStore, versionStore, versionMetadataStore } =
        await readAcquisitionRows(transaction, transactionSettlement, checkpointId, bufferIds, versionKeys);
    if (existingRetention !== undefined) {
        await transactionSettlement;
        throw new Error(`Checkpoint audio retention already exists for ${checkpointId}.`);
    }
    const ordinaryPairs = ordinaryValues.map(([data, metadata], index) => {
        const pair = readOrdinaryPair(data, metadata);
        if (
            pair === null ||
            pair.persistenceRevision !== authority.expectedPersistenceRevisionById.get(bufferIds[index]!)
        ) {
            return null;
        }
        return pair;
    });
    if (ordinaryPairs.some((pair) => pair === null)) {
        await transactionSettlement;
        return { status: 'superseded' as const };
    }
    if (!authority.isCurrent()) {
        await transactionSettlement;
        return { status: 'superseded' as const };
    }
    for (let index = 0; index < versionKeys.length; index++) {
        const versionKey = versionKeys[index]!;
        const [existingData, existingMetadata] = existingVersions[index]!;
        if (existingData !== undefined || existingMetadata !== undefined) {
            if (existingData === undefined || existingMetadata === undefined) {
                return settleThenThrow(
                    transactionSettlement,
                    new Error(`Checkpoint audio version is incomplete for ${versionKey}.`)
                );
            }
            try {
                assertVersionPair(versionKey, existingData, existingMetadata);
            } catch (error) {
                return settleThenThrow(transactionSettlement, error);
            }
        }
    }
    let ownershipToken: string;
    try {
        ownershipToken = crypto.randomUUID();
        queueAcquisitionWrites({
            checkpointId,
            projectOwnerId,
            ownershipToken,
            bufferIds,
            versionKeys,
            ordinaryPairs: ordinaryPairs as OrdinaryPair[],
            existingVersions,
            retentionStore,
            versionStore,
            versionMetadataStore,
        });
    } catch (error) {
        return abortThenThrow(transaction, transactionSettlement, error);
    }
    await transactionSettlement;
    return { status: 'retained' as const, ownershipToken };
}

async function read(
    openDatabase: RepositoryDependencies['openDatabase'],
    { checkpointId, projectOwnerId, ownershipToken, expectedBufferIds, audioContext }: ReadInput
) {
    const expectedIds = canonicalAudioBufferIds(expectedBufferIds);
    const database = await openDatabase();
    const transaction = database.transaction(
        [
            CHECKPOINT_RETENTION_STORE_NAME,
            CHECKPOINT_AUDIO_VERSION_STORE_NAME,
            CHECKPOINT_AUDIO_VERSION_META_STORE_NAME,
        ],
        'readonly'
    );
    const transactionSettlement = awaitTransaction(transaction);
    const retentionStore = transaction.objectStore(CHECKPOINT_RETENTION_STORE_NAME);
    const retentionValue = await awaitRequests(
        awaitRequest(retentionStore.get(checkpointId) as IDBRequest<unknown>),
        transactionSettlement
    );
    const retention = readCheckpointAudioRetention(retentionValue, checkpointId);
    if (
        retention === null ||
        retention.projectOwnerId !== projectOwnerId ||
        retention.ownershipToken !== ownershipToken ||
        retentionBufferIds(retention).some((bufferId, index) => bufferId !== expectedIds[index]) ||
        retention.versionKeys.length !== expectedIds.length
    ) {
        await transactionSettlement;
        return { status: 'refused' as const };
    }
    const versionStore = transaction.objectStore(CHECKPOINT_AUDIO_VERSION_STORE_NAME);
    const versionMetadataStore = transaction.objectStore(CHECKPOINT_AUDIO_VERSION_META_STORE_NAME);
    const pairs = await awaitRequests(
        Promise.all(
            retention.versionKeys.map((versionKey) =>
                Promise.all([
                    awaitRequest(versionStore.get(versionKey) as IDBRequest<unknown>),
                    awaitRequest(versionMetadataStore.get(versionKey) as IDBRequest<unknown>),
                ])
            )
        ),
        transactionSettlement
    );
    let versions: Array<{ data: SerializedAudioBuffer; metadata: CheckpointAudioVersionMetadata }>;
    try {
        versions = pairs.map(([data, metadata], index) =>
            assertVersionPair(retention.versionKeys[index]!, data, metadata)
        );
    } catch (error) {
        return settleThenThrow(transactionSettlement, error);
    }
    await transactionSettlement;
    const decodedAudioBuffers = Object.fromEntries(
        versions.map(({ data, metadata }) => [metadata.bufferId, createAudioBuffer(audioContext, data)])
    ) as Record<string, AudioBuffer>;
    return { status: 'read' as const, decodedAudioBuffers };
}

async function release(
    openDatabase: RepositoryDependencies['openDatabase'],
    { checkpointId, projectOwnerId, ownershipToken }: ReleaseInput
): Promise<boolean> {
    const database = await openDatabase();
    const transaction = database.transaction(
        [
            CHECKPOINT_RETENTION_STORE_NAME,
            CHECKPOINT_AUDIO_VERSION_STORE_NAME,
            CHECKPOINT_AUDIO_VERSION_META_STORE_NAME,
        ],
        'readwrite'
    );
    const transactionSettlement = awaitTransaction(transaction);
    const retentionStore = transaction.objectStore(CHECKPOINT_RETENTION_STORE_NAME);
    const retentionValue = await awaitRequests(
        awaitRequest(retentionStore.get(checkpointId) as IDBRequest<unknown>),
        transactionSettlement
    );
    const retention = readCheckpointAudioRetention(retentionValue, checkpointId);
    if (
        retention === null ||
        retention.projectOwnerId !== projectOwnerId ||
        retention.ownershipToken !== ownershipToken
    ) {
        await transactionSettlement;
        return false;
    }
    const [retentionValues, retentionKeys] = await awaitRequests(
        Promise.all([
            awaitRequest(retentionStore.getAll() as IDBRequest<unknown[]>),
            awaitRequest(retentionStore.getAllKeys()),
        ]),
        transactionSettlement
    );
    let remainingRetentions: CheckpointAudioRetention[];
    try {
        remainingRetentions = retentionsFromRows(retentionValues, retentionKeys).filter(
            (candidate) => candidate.checkpointId !== checkpointId
        );
    } catch (error) {
        return settleThenThrow(transactionSettlement, error);
    }
    const remainingVersionKeys = new Set(remainingRetentions.flatMap((candidate) => candidate.versionKeys));
    const versionStore = transaction.objectStore(CHECKPOINT_AUDIO_VERSION_STORE_NAME);
    const versionMetadataStore = transaction.objectStore(CHECKPOINT_AUDIO_VERSION_META_STORE_NAME);
    const releasedPairs = await awaitRequests(
        Promise.all(
            retention.versionKeys.map((versionKey) =>
                Promise.all([
                    awaitRequest(versionStore.get(versionKey) as IDBRequest<unknown>),
                    awaitRequest(versionMetadataStore.get(versionKey) as IDBRequest<unknown>),
                ])
            )
        ),
        transactionSettlement
    );
    try {
        for (const [index, [data, metadata]] of releasedPairs.entries()) {
            assertVersionPair(retention.versionKeys[index]!, data, metadata);
        }
    } catch (error) {
        return settleThenThrow(transactionSettlement, error);
    }
    try {
        retentionStore.delete(checkpointId);
        for (const versionKey of retention.versionKeys) {
            if (!remainingVersionKeys.has(versionKey)) {
                versionStore.delete(versionKey);
                versionMetadataStore.delete(versionKey);
            }
        }
    } catch (error) {
        return abortThenThrow(transaction, transactionSettlement, error);
    }
    await transactionSettlement;
    return true;
}

async function collectCensus(
    openDatabase: RepositoryDependencies['openDatabase']
): Promise<{ immutableBytes: number; retainedBufferIds: ReadonlySet<string> }> {
    const database = await openDatabase();
    const transaction = database.transaction(
        [
            CHECKPOINT_RETENTION_STORE_NAME,
            CHECKPOINT_AUDIO_VERSION_STORE_NAME,
            CHECKPOINT_AUDIO_VERSION_META_STORE_NAME,
        ],
        'readonly'
    );
    const transactionSettlement = awaitTransaction(transaction);
    const retentionStore = transaction.objectStore(CHECKPOINT_RETENTION_STORE_NAME);
    const versionStore = transaction.objectStore(CHECKPOINT_AUDIO_VERSION_STORE_NAME);
    const versionMetadataStore = transaction.objectStore(CHECKPOINT_AUDIO_VERSION_META_STORE_NAME);
    const [retentionValues, retentionKeys, metadataValues, metadataKeys, versionKeys] = await awaitRequests(
        Promise.all([
            awaitRequest(retentionStore.getAll() as IDBRequest<unknown[]>),
            awaitRequest(retentionStore.getAllKeys()),
            awaitRequest(versionMetadataStore.getAll() as IDBRequest<unknown[]>),
            awaitRequest(versionMetadataStore.getAllKeys()),
            awaitRequest(versionStore.getAllKeys()),
        ]),
        transactionSettlement
    );
    try {
        const retentions = retentionsFromRows(retentionValues, retentionKeys);
        if (metadataValues.length !== metadataKeys.length) {
            throw new Error('Checkpoint audio version metadata is unreadable.');
        }
        const metadataByKey = new Map<string, CheckpointAudioVersionMetadata>();
        let immutableBytes = 0;
        for (let index = 0; index < metadataKeys.length; index++) {
            const key = metadataKeys[index];
            const metadata = readCheckpointAudioVersionMetadata(metadataValues[index], key!);
            if (metadata === null || metadataByKey.has(metadata.versionKey)) {
                throw new Error('Checkpoint audio version metadata is invalid.');
            }
            metadataByKey.set(metadata.versionKey, metadata);
            immutableBytes += metadata.sizeInBytes;
            if (!Number.isSafeInteger(immutableBytes)) {
                throw new TypeError('Checkpoint audio version byte total is invalid.');
            }
        }
        const physicalKeys = new Set<string>();
        for (const key of versionKeys) {
            if (typeof key !== 'string' || readCheckpointAudioVersionKey(key) === null || physicalKeys.has(key)) {
                throw new Error('Checkpoint audio version keys are invalid.');
            }
            physicalKeys.add(key);
        }
        if (
            metadataByKey.size !== physicalKeys.size ||
            [...metadataByKey.keys()].some((versionKey) => !physicalKeys.has(versionKey))
        ) {
            throw new Error('Checkpoint audio version backing is incomplete.');
        }
        const retainedBufferIds = new Set<string>();
        for (const retention of retentions) {
            for (const versionKey of retention.versionKeys) {
                const identity = readCheckpointAudioVersionKey(versionKey)!;
                if (!metadataByKey.has(versionKey)) {
                    throw new Error(`Checkpoint audio retention references missing PCM ${versionKey}.`);
                }
                retainedBufferIds.add(identity[0]);
            }
        }
        await transactionSettlement;
        return { immutableBytes, retainedBufferIds };
    } catch (error) {
        return settleThenThrow(transactionSettlement, error);
    }
}

export function createCheckpointAudioRetentionRepository({ openDatabase }: RepositoryDependencies) {
    return {
        acquire: (input: AcquireInput) => acquire(openDatabase, input),
        read: (input: ReadInput) => read(openDatabase, input),
        release: (input: ReleaseInput) => release(openDatabase, input),
        collectCensus: () => collectCensus(openDatabase),
    };
}
