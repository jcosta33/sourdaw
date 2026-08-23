import { logger } from '#/infra/logger/appLogger';
import { base64ToBytes, bytesToBase64 } from '#/utils/base64';

import {
    ASSET_CHUNK_SIZE,
    ASSET_REQUEST_MAX_ATTEMPTS,
    ASSET_REQUEST_RETRY_COOLDOWN_MS,
    MAX_ASSET_CHUNK_SIZE,
    MAX_ASSET_MIME_LEN,
    MAX_ASSET_NAME_LEN,
    MAX_ASSET_SIZE,
    MAX_CONCURRENT_ASSET_RESPONSES_PER_PEER,
    MIN_ASSET_CHUNK_SIZE,
    type PeerId,
    type PeerMessage,
} from '../models/CollaborationTypes';
import { DOC_ID_ASSET } from '../models/SyncChannelConstants';
import { durableAssetOwnerResolution } from '../repositories/durableAssetOwnerResolution';
import {
    createDurableAssetRepository,
    DEFAULT_STAGE_RECOVERY_PREFIX,
    type DurableAssetRepository,
    type DurableAssetCommitProof,
    type PromoteStagedAssetResult,
    type RebindDurableAssetOwnerResult,
    type ReleaseOwnedAssetResult,
    type ReleaseStagedAssetResult,
    type ReleaseStagedAssetsResult,
    type ReopenDurableAssetResult,
    type ReopenStagedAssetResult,
    type StagedAssetBinding,
} from '../repositories/durableAssetRepository';
import { type PeerConnectionManager } from '../repositories/peerConnection';

import { durableAssetCommitProof } from './configureDurableAssetCommitProof';

function getDefaultStageRecoveryId(leaseId: string): string {
    return `${DEFAULT_STAGE_RECOVERY_PREFIX}${leaseId}`;
}

/**
 * How long a solicited transfer may go without progress before it is abandoned.
 *
 * The window covers both stalls with the same clock: waiting for the manifest
 * after a request, and waiting for the next chunk once chunks are flowing. A
 * transfer that never completes must release its partial state rather than pin
 * it for the rest of the session — the receiver has no other signal that the
 * sending peer died mid-stream.
 */
export const ASSET_TRANSFER_STALL_TIMEOUT_MS = 30_000;

export type AssetManifest = {
    hash: string;
    size: number;
    chunkSize: number;
    chunkCount: number;
    name: string;
    mime: string;
};

type AssetControlMessage =
    | { type: 'asset.request'; hash: string; missingChunks: number[] }
    | { type: 'asset.manifest'; manifest: AssetManifest }
    | { type: 'asset.chunk'; hash: string; index: number; data: string };

type AssetTransferCallbacks = {
    onAssetAvailable: (hash: string) => void;
    onProgress: (hash: string, receivedChunks: number, totalChunks: number) => void;
    /**
     * A solicited transfer ended without producing the asset — rejected chunk,
     * failed integrity check, or a stall past
     * {@link ASSET_TRANSFER_STALL_TIMEOUT_MS}. By the time this fires the hash
     * is no longer outstanding and no longer in flight, so the receiver is free
     * to request it again.
     */
    onTransferFailed: (hash: string, reason: string) => void;
};

type LocalAssetEntry = {
    blob: Blob;
    name: string;
    durable: boolean;
    stagingLeaseIds: Set<string>;
};

type DurableAssetCacheEntry = Pick<LocalAssetEntry, 'blob' | 'name'>;

// Reserve durable operations when called, not when a per-instance predecessor
// settles, so a handoff cannot overtake staging already accepted by any transfer.
let durableOwnerOperationTail: Promise<void> = Promise.resolve();

function runDurableOwnerOperation<Result>(operation: () => Promise<Result>): Promise<Result> {
    const task = durableOwnerOperationTail.then(operation);
    durableOwnerOperationTail = task.then(
        () => undefined,
        () => undefined
    );
    return task;
}

// A pending confirmation outlives the transport object that happened to stage
// its bytes. Keep one live owner per exact default recovery until that caller
// promotes or releases it. A renderer restart clears this process registry, so
// abandoned stages still follow durable default-release recovery on startup.
const liveStageRecoveryOwnerById = new Map<string, string>();

function protectLiveStageRecovery(ownerId: string, recoveryId: string): void {
    if (!liveStageRecoveryOwnerById.has(recoveryId)) {
        liveStageRecoveryOwnerById.set(recoveryId, ownerId);
    }
}

function releaseLiveStageRecovery(recoveryId: string): void {
    liveStageRecoveryOwnerById.delete(recoveryId);
}

function getLiveStageRecoveries(ownerId: string): ReadonlySet<string> {
    return new Set(
        [...liveStageRecoveryOwnerById.entries()].flatMap(([recoveryId, protectedOwnerId]) =>
            protectedOwnerId === ownerId ? [recoveryId] : []
        )
    );
}

function rebindLiveStageRecoveries(previousOwnerId: string, nextOwnerId: string): void {
    for (const [recoveryId, protectedOwnerId] of liveStageRecoveryOwnerById) {
        if (protectedOwnerId === previousOwnerId) {
            liveStageRecoveryOwnerById.set(recoveryId, nextOwnerId);
        }
    }
}

type AssetTransferDurabilityOptions = {
    durableStagingReady?: boolean;
    handoffSourceOwnerIds?: readonly string[];
};

type DurableAssetStageOptions = {
    protectAcrossTransfer?: boolean;
};

/**
 * Content-addressed asset transfer over WebRTC data channels.
 *
 * Assets are identified by BLAKE3 hash (or SHA-256 as fallback in browser).
 * Transfer is chunked with bitmap-based resume.
 */
export class AssetTransfer {
    private peerManager: PeerConnectionManager;
    private callbacks: AssetTransferCallbacks;
    private durableAssets: DurableAssetRepository;
    private readonly durableOwnerHandoffSources: Map<string, DurableAssetRepository>;
    private ownerId: string;
    private unsubscribeInvalidation: (() => void) | null;
    private disposed = false;
    private durableStagingReady: boolean;
    private ownerRecoveryPending = true;
    private readonly protectedStageRecoveryIds = new Set<string>();
    /** Serializes every operation whose durable authority is bound to ownerId. */
    private ownerOperationTail = Promise.resolve();

    /** Session-owned assets retain the live import/peer-transfer contract. */
    private localAssets = new Map<string, LocalAssetEntry>();
    private stagingLeaseHashById = new Map<string, string>();
    /** Restartable IndexedDB bytes stay distinct from session staging authority. */
    private durableAssetCache = new Map<string, DurableAssetCacheEntry>();

    /** In-flight incoming transfers: hash → { chunks, received bitmap } */
    private incomingTransfers = new Map<
        string,
        {
            manifest: AssetManifest;
            chunks: Map<number, Uint8Array>;
            receivedBitmap: Set<number>;
        }
    >();

    /**
     * Hashes this peer has actively requested and has not yet resolved. A
     * manifest is only accepted if its hash is in this set, so a remote peer
     * cannot start (and grow) a transfer slot we never asked for
     * (unsolicited-manifest DoS).
     *
     * Membership lasts until the request reaches a terminal state — the asset
     * is assembled, or the transfer is aborted — not merely until a manifest is
     * chosen. Dropping it at manifest time reopened the unsolicited-manifest
     * hole the moment a transfer was abandoned, and left `requestAsset` with no
     * way to tell "already asked, still waiting" from "never asked".
     */
    private requestedHashes = new Set<string>();

    /**
     * Per-hash stall deadline. Armed when a hash is requested, re-armed on an
     * accepted manifest and on any chunk that added an index the transfer did
     * not already hold, so the timer measures time since the last observable
     * progress rather than total transfer duration. A re-delivered chunk is not
     * progress and deliberately does not restart it.
     */
    private stallTimers = new Map<string, ReturnType<typeof setTimeout>>();

    /**
     * Earliest wall-clock time each aborted hash may be re-requested.
     *
     * The scheduler calls `requestAsset` on every tick for every missing clip,
     * so the request path has no memory of its own; this is that memory. An
     * entry is written on abort and dropped once the asset resolves.
     */
    private retryNotBefore = new Map<string, number>();

    /** Aborted attempts per hash, counted toward {@link ASSET_REQUEST_MAX_ATTEMPTS}. */
    private failedAttempts = new Map<string, number>();

    /**
     * Hashes abandoned for the rest of the session after too many aborts. A
     * peer can write any string into `clip.assetHash`, so without a terminal
     * state a hash no peer holds re-broadcasts forever.
     */
    private abandonedHashes = new Set<string>();

    /**
     * Hashes this host is currently serving, per requesting peer.
     *
     * A request is cheap to send and expensive to answer, so identical requests
     * arriving while one is being served are dropped rather than served
     * concurrently, and the number of distinct assets one peer may pull at once
     * is capped.
     */
    private servingHashesByPeer = new Map<PeerId, Set<string>>();

    constructor(
        peerManager: PeerConnectionManager,
        callbacks: AssetTransferCallbacks,
        ownerId: string,
        durableAssets: DurableAssetRepository = createDurableAssetRepository(ownerId),
        durabilityOptions: AssetTransferDurabilityOptions = {}
    ) {
        this.peerManager = peerManager;
        this.callbacks = callbacks;
        this.ownerId = ownerId;
        this.durableAssets = durableAssets;
        this.durableOwnerHandoffSources = new Map(
            [...new Set(durabilityOptions.handoffSourceOwnerIds ?? [])]
                .filter((sourceOwnerId) => sourceOwnerId !== ownerId)
                .map((sourceOwnerId) => [sourceOwnerId, createDurableAssetRepository(sourceOwnerId)])
        );
        this.durableStagingReady = durabilityOptions.durableStagingReady ?? true;
        this.unsubscribeInvalidation = durableAssets.subscribeInvalidation((event) => {
            if (this.disposed) {
                return;
            }
            if (event.ownerId === undefined || event.ownerId === this.ownerId) {
                this.durableAssetCache.delete(event.hash);
            }
        });
        void this.runOwnerOperation(async () => undefined).catch((error: unknown) => {
            if (!this.disposed) {
                logger.error(new Error('Durable asset startup recovery failed', { cause: error }));
            }
        });
    }

    /**
     * Drop every in-flight transfer, its partial chunks, and its stall timer.
     *
     * The session owner discards this instance on teardown; without an explicit
     * disposal the armed timers keep firing against a dead session and the
     * retained chunk buffers outlive it.
     */
    dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        for (const timer of this.stallTimers.values()) {
            clearTimeout(timer);
        }
        this.stallTimers.clear();
        this.incomingTransfers.clear();
        this.requestedHashes.clear();
        this.retryNotBefore.clear();
        this.failedAttempts.clear();
        this.abandonedHashes.clear();
        this.servingHashesByPeer.clear();
        this.localAssets.clear();
        this.stagingLeaseHashById.clear();
        this.durableAssetCache.clear();
        this.unsubscribeInvalidation?.();
        this.unsubscribeInvalidation = null;
    }

    /** Register a local asset (e.g. after recording or importing). */
    async addLocalAsset(blob: Blob, name: string): Promise<string> {
        const hash = await hashBlob(blob);
        if (this.disposed) {
            throw new Error('AssetTransfer is disposed');
        }
        const existing = this.localAssets.get(hash);
        if (existing) {
            existing.durable = true;
        } else {
            this.localAssets.set(hash, { blob, name, durable: true, stagingLeaseIds: new Set() });
        }
        return hash;
    }

    /** Stage an import in this live Collaboration session until commit or cancellation. */
    async stageLocalAsset(blob: Blob, name: string): Promise<{ hash: string; leaseId: string }> {
        const hash = await hashBlob(blob);
        if (this.disposed) {
            throw new Error('AssetTransfer is disposed');
        }
        const leaseId = `asset-stage-${crypto.randomUUID()}`;
        const existing = this.localAssets.get(hash);
        if (existing) {
            existing.stagingLeaseIds.add(leaseId);
        } else {
            this.localAssets.set(hash, { blob, name, durable: false, stagingLeaseIds: new Set([leaseId]) });
        }
        this.stagingLeaseHashById.set(leaseId, hash);
        return { hash, leaseId };
    }

    /** Release one unresolved live-session staging reference. */
    releaseStagedAsset(leaseId: string): void {
        const hash = this.stagingLeaseHashById.get(leaseId);
        if (!hash) {
            return;
        }
        this.stagingLeaseHashById.delete(leaseId);
        const entry = this.localAssets.get(hash);
        if (!entry) {
            return;
        }
        entry.stagingLeaseIds.delete(leaseId);
        if (!entry.durable && entry.stagingLeaseIds.size === 0) {
            this.localAssets.delete(hash);
        }
    }

    /** Promote one live-session staging reference to committed availability. */
    promoteStagedAsset(leaseId: string): void {
        const hash = this.stagingLeaseHashById.get(leaseId);
        if (!hash) {
            return;
        }
        this.stagingLeaseHashById.delete(leaseId);
        const entry = this.localAssets.get(hash);
        if (!entry) {
            throw new Error(`Cannot promote missing staged asset lease: ${leaseId}`);
        }
        entry.stagingLeaseIds.delete(leaseId);
        entry.durable = true;
    }

    /** Stage a caller-keyed restartable original for future #2648 integration. */
    async stageDurableAsset(
        blob: Blob,
        name: string,
        leaseId: string,
        options: DurableAssetStageOptions = {}
    ): Promise<{ hash: string; leaseId: string }> {
        this.protectedStageRecoveryIds.add(getDefaultStageRecoveryId(leaseId));
        return this.runOwnerOperation(async (durableAssets) => {
            if (!this.durableStagingReady) {
                throw new Error('Durable asset staging is unavailable until synchronized owner persistence completes');
            }
            const staged = await durableAssets.stageAsset(leaseId, blob, name);
            const recoveryId = getDefaultStageRecoveryId(staged.leaseId);
            if (options.protectAcrossTransfer) {
                // Register while this owner's durable operation is still held.
                // A replacement transfer's startup recovery is serialized
                // behind this point and therefore cannot release the stage in
                // the gap between durable commit and the caller receiving it.
                protectLiveStageRecovery(this.ownerId, recoveryId);
            }
            if (!this.disposed) {
                this.protectedStageRecoveryIds.add(recoveryId);
                this.durableAssetCache.set(staged.hash, { blob: staged.blob, name: staged.name });
            }
            return { hash: staged.hash, leaseId: staged.leaseId };
        });
    }

    /** Keep one caller-owned staged lease live while its transport object is replaced. */
    protectDurableStagedAssetAcrossTransfer(leaseId: string): void {
        if (this.disposed) {
            throw new Error('AssetTransfer is disposed');
        }
        const recoveryId = getDefaultStageRecoveryId(leaseId);
        this.protectedStageRecoveryIds.add(recoveryId);
        protectLiveStageRecovery(this.ownerId, recoveryId);
    }

    /** Verify and reopen one exact staged original after owner recreation. */
    async reopenDurableStagedAsset(leaseId: string, expectedHash: string): Promise<ReopenStagedAssetResult> {
        // Possession of the exact lease/hash pair is the live caller renewing
        // ownership of a pending stage after recreation. Protect its default
        // release claim before startup recovery can treat it as abandoned.
        const defaultRecoveryId = getDefaultStageRecoveryId(leaseId);
        this.protectedStageRecoveryIds.add(defaultRecoveryId);
        return this.runOwnerOperation(async (durableAssets) => {
            const result = await durableAssets.reopenStagedAsset(leaseId, expectedHash);
            if (result.status === 'failed') {
                if (result.reason !== 'lease-hash-mismatch' && result.reason !== 'lease-owner-mismatch') {
                    this.protectedStageRecoveryIds.delete(defaultRecoveryId);
                    releaseLiveStageRecovery(defaultRecoveryId);
                }
            }
            if (result.status === 'opened' && !this.disposed) {
                this.durableAssetCache.set(result.hash, { blob: result.blob, name: result.name });
            }
            return result;
        });
    }

    /** Verify and reopen one project-owned original after owner recreation. */
    async reopenDurableAsset(hash: string): Promise<ReopenDurableAssetResult> {
        return this.runOwnerOperation(async (durableAssets) => {
            const result = await durableAssets.reopenDurableAsset(hash);
            if (result.status === 'opened' && !this.disposed) {
                this.durableAssetCache.set(result.hash, { blob: result.blob, name: result.name });
            }
            return result;
        });
    }

    /** Release one hash-bound staging reference exactly once. */
    async releaseDurableStagedAsset(leaseId: string, expectedHash: string): Promise<ReleaseStagedAssetResult> {
        const defaultRecoveryId = getDefaultStageRecoveryId(leaseId);
        this.protectedStageRecoveryIds.add(defaultRecoveryId);
        const result = await this.runOwnerOperation(async (durableAssets) => {
            const result = await durableAssets.releaseStagedAsset(leaseId, expectedHash);
            if (!this.disposed && result.status === 'released' && !result.ownerRetained) {
                this.durableAssetCache.delete(result.hash);
            }
            return result;
        });
        if (result.status !== 'failed') {
            this.protectedStageRecoveryIds.delete(defaultRecoveryId);
            releaseLiveStageRecovery(defaultRecoveryId);
        }
        return result;
    }

    /** Atomically release a complete prepared resource set or leave every lease staged. */
    async releaseDurableStagedAssets(bindings: readonly StagedAssetBinding[]): Promise<ReleaseStagedAssetsResult> {
        const defaultRecoveryIds = bindings.map((binding) => getDefaultStageRecoveryId(binding.leaseId));
        for (const recoveryId of defaultRecoveryIds) {
            this.protectedStageRecoveryIds.add(recoveryId);
        }
        const result = await this.runOwnerOperation(async (durableAssets) => {
            const result = await durableAssets.releaseStagedAssets(bindings);
            if (!this.disposed && result.status === 'released') {
                for (const release of result.releases) {
                    if (release.status === 'released' && !release.ownerRetained) {
                        this.durableAssetCache.delete(release.hash);
                    }
                }
            }
            return result;
        });
        if (result.status !== 'failed') {
            for (const recoveryId of defaultRecoveryIds) {
                this.protectedStageRecoveryIds.delete(recoveryId);
                releaseLiveStageRecovery(recoveryId);
            }
        }
        return result;
    }

    /** Promote one hash-bound staging reference exactly once. */
    async promoteDurableStagedAsset(leaseId: string, expectedHash: string): Promise<PromoteStagedAssetResult> {
        const defaultRecoveryId = getDefaultStageRecoveryId(leaseId);
        this.protectedStageRecoveryIds.add(defaultRecoveryId);
        const result = await this.runOwnerOperation(async (durableAssets) => {
            const result = await durableAssets.promoteStagedAsset(leaseId, expectedHash);
            if (!this.disposed && result.status !== 'failed') {
                this.durableAssetCache.set(result.hash, { blob: result.blob, name: result.name });
            }
            return result;
        });
        if (result.status !== 'failed') {
            this.protectedStageRecoveryIds.delete(defaultRecoveryId);
            releaseLiveStageRecovery(defaultRecoveryId);
        }
        return result;
    }

    /** Persist exact committed-asset promotion ownership before the project transaction starts. */
    async prepareDurablePromotionRecovery(
        recoveryId: string,
        bindings: readonly StagedAssetBinding[],
        commitProof?: DurableAssetCommitProof
    ) {
        const result = await this.runBindingOwnerOperation(bindings, (durableAssets) =>
            durableAssets.preparePromotionRecovery(recoveryId, bindings, commitProof)
        );
        if (result.status !== 'failed') {
            for (const binding of bindings) {
                const recoveryId = getDefaultStageRecoveryId(binding.leaseId);
                this.protectedStageRecoveryIds.delete(recoveryId);
                releaseLiveStageRecovery(recoveryId);
            }
        }
        return result;
    }

    /** Make a prepared promotion restart-executable after the command returns durable commit proof. */
    async commitDurablePromotionRecovery(recoveryId: string) {
        return this.runRecoveryOwnerOperation(recoveryId, (durableAssets) =>
            durableAssets.commitPromotionRecovery(recoveryId)
        );
    }

    /** Prove every committed lease promoted before retiring its durable recovery journal. */
    async completeDurablePromotionRecovery(recoveryId: string) {
        return this.runRecoveryOwnerOperation(recoveryId, (durableAssets) =>
            durableAssets.completePromotionRecovery(recoveryId)
        );
    }

    /** Retire a pre-commit recovery claim before releasing its staged leases. */
    async cancelDurablePromotionRecovery(recoveryId: string) {
        return this.runRecoveryOwnerOperation(recoveryId, (durableAssets) =>
            durableAssets.cancelPromotionRecovery(recoveryId)
        );
    }

    /** Persist exact staged-asset cleanup ownership before a terminal caller may disappear. */
    async prepareDurableCleanupRecovery(recoveryId: string, bindings: readonly StagedAssetBinding[]) {
        const result = await this.runBindingOwnerOperation(bindings, (durableAssets) =>
            durableAssets.prepareCleanupRecovery(recoveryId, bindings)
        );
        if (result.status !== 'failed') {
            for (const binding of bindings) {
                const recoveryId = getDefaultStageRecoveryId(binding.leaseId);
                this.protectedStageRecoveryIds.delete(recoveryId);
                releaseLiveStageRecovery(recoveryId);
            }
        }
        return result;
    }

    /** Atomically replace a pre-commit promotion claim with exact restart-safe cleanup ownership. */
    async transitionDurablePromotionRecoveryToCleanup(recoveryId: string, bindings: readonly StagedAssetBinding[]) {
        return this.runBindingOwnerOperation(bindings, (durableAssets) =>
            durableAssets.transitionPromotionRecoveryToCleanup(recoveryId, bindings)
        );
    }

    /** Release every cleanup-owned lease and retire its journal atomically. */
    async completeDurableCleanupRecovery(recoveryId: string) {
        return this.runRecoveryOwnerOperation(recoveryId, (durableAssets) =>
            durableAssets.completeCleanupRecovery(recoveryId)
        );
    }

    /** Release this project identity's durable reference without affecting another project. */
    async releaseDurableAsset(hash: string): Promise<ReleaseOwnedAssetResult> {
        return this.runOwnerOperation((durableAssets) => durableAssets.releaseOwnedAsset(hash));
    }

    /** Journal the exact provisional-to-project handoff before CRDT persistence begins. */
    async prepareDurableOwnerRebind(nextOwnerId: string) {
        return this.runOwnerOperation(async (durableAssets) => {
            const createdRepositories: DurableAssetRepository[] = [];
            const prepare = async (repository: DurableAssetRepository) => {
                const prepared = await repository.prepareOwnerRebind(nextOwnerId);
                if (prepared.status !== 'failed' && prepared.created) {
                    createdRepositories.push(repository);
                }
                return prepared;
            };
            const rollbackCreated = async () => {
                const failures: string[] = [];
                for (const repository of createdRepositories.toReversed()) {
                    try {
                        const aborted = await repository.abortOwnerRebind(nextOwnerId);
                        if (aborted.status === 'failed') {
                            failures.push(aborted.reason);
                        }
                    } catch (error) {
                        failures.push(error instanceof Error ? error.message : String(error));
                    }
                }
                if (failures.length > 0) {
                    throw new Error(`Durable asset owner handoff rollback failed: ${failures.join('; ')}`);
                }
            };

            let current: Awaited<ReturnType<DurableAssetRepository['prepareOwnerRebind']>>;
            try {
                current = await prepare(durableAssets);
                if (current.status === 'failed') {
                    return current;
                }
                for (const source of this.durableOwnerHandoffSources.values()) {
                    const incoming = await source.resumeOwnerRebinds();
                    if (incoming.status === 'failed') {
                        await rollbackCreated();
                        return incoming;
                    }
                    const prepared = await prepare(source);
                    if (prepared.status === 'failed') {
                        await rollbackCreated();
                        return prepared;
                    }
                }
            } catch (error) {
                await rollbackCreated();
                throw error;
            }

            let settled: 'pending' | 'committing' | 'committed' | 'aborted' = 'pending';
            return {
                ...current,
                commit: async () => {
                    if (settled === 'aborted') {
                        throw new Error('Durable asset owner handoff was already aborted');
                    }
                    if (settled === 'committed') {
                        return;
                    }
                    settled = 'committing';
                    const committed = await this.commitDurableOwnerRebind(nextOwnerId);
                    if (committed.status === 'failed') {
                        throw new Error(`Durable asset owner rebind failed: ${committed.reason}`);
                    }
                    settled = 'committed';
                },
                abort: async () => {
                    if (settled === 'committing' || settled === 'committed') {
                        throw new Error('Durable asset owner handoff commit already started');
                    }
                    if (settled === 'aborted') {
                        return;
                    }
                    await runDurableOwnerOperation(rollbackCreated);
                    settled = 'aborted';
                },
            };
        });
    }

    /** Commit a journaled handoff after CRDT persistence has adopted the project owner. */
    async commitDurableOwnerRebind(nextOwnerId: string): Promise<RebindDurableAssetOwnerResult> {
        return this.runOwnerOperation(async (durableAssets) => {
            const previousOwnerId = this.ownerId;
            const reboundHashes = new Set<string>();
            for (const source of [durableAssets, ...this.durableOwnerHandoffSources.values()]) {
                const result = await source.commitOwnerRebind(nextOwnerId);
                if (result.status === 'failed') {
                    return result;
                }
                rebindLiveStageRecoveries(result.previousOwnerId, nextOwnerId);
                for (const hash of result.reboundHashes) {
                    reboundHashes.add(hash);
                }
            }
            if (this.disposed) {
                return {
                    status: 'rebound',
                    previousOwnerId,
                    ownerId: nextOwnerId,
                    reboundHashes: [...reboundHashes],
                };
            }
            this.unsubscribeInvalidation?.();
            this.ownerId = nextOwnerId;
            this.durableAssets = createDurableAssetRepository(nextOwnerId);
            this.durableOwnerHandoffSources.clear();
            this.ownerRecoveryPending = true;
            this.durableStagingReady = true;
            this.unsubscribeInvalidation = this.durableAssets.subscribeInvalidation((event) => {
                if (this.disposed) {
                    return;
                }
                if (event.ownerId === undefined || event.ownerId === this.ownerId) {
                    this.durableAssetCache.delete(event.hash);
                }
            });
            return {
                status: 'rebound',
                previousOwnerId,
                ownerId: nextOwnerId,
                reboundHashes: [...reboundHashes],
            };
        });
    }

    private runOwnerOperation<Result>(
        operation: (durableAssets: DurableAssetRepository) => Promise<Result>,
        options: { resumeRecoveries?: boolean } = {}
    ): Promise<Result> {
        const transferPredecessor = this.ownerOperationTail;
        const task = runDurableOwnerOperation(async () => {
            await transferPredecessor;
            if (this.disposed) {
                throw new Error('AssetTransfer is disposed');
            }
            return (async () => {
                if (this.ownerRecoveryPending) {
                    const recovery = await this.durableAssets.resumeOwnerRebinds();
                    if (recovery.status === 'failed') {
                        throw new Error(`Durable asset owner recovery failed: ${recovery.reason}`);
                    }
                    for (const previousOwnerId of recovery.previousOwnerIds) {
                        rebindLiveStageRecoveries(previousOwnerId, recovery.ownerId);
                    }
                    this.ownerRecoveryPending = false;
                }
                if (options.resumeRecoveries !== false) {
                    const protectedRecoveryIds = new Set([
                        ...this.protectedStageRecoveryIds,
                        ...getLiveStageRecoveries(this.ownerId),
                    ]);
                    const recovery = await this.durableAssets.resumeRecoveries(
                        protectedRecoveryIds,
                        durableAssetCommitProof.isProven
                    );
                    if (recovery.status === 'failed') {
                        throw new Error(`Durable asset promotion recovery failed: ${recovery.reason}`);
                    }
                }
                return operation(this.durableAssets);
            })();
        });
        this.ownerOperationTail = task.then(
            () => undefined,
            () => undefined
        );
        return task;
    }

    private runBindingOwnerOperation<Result>(
        bindings: readonly StagedAssetBinding[],
        operation: (durableAssets: DurableAssetRepository) => Promise<Result>
    ) {
        return this.runOwnerOperation(
            async (current) => {
                const resolved = await durableAssetOwnerResolution.binding(bindings);
                if (resolved.status === 'failed') {
                    return resolved;
                }
                return operation(
                    resolved.ownerId === this.ownerId ? current : createDurableAssetRepository(resolved.ownerId)
                );
            },
            { resumeRecoveries: false }
        );
    }

    private runRecoveryOwnerOperation<Result>(
        recoveryId: string,
        operation: (durableAssets: DurableAssetRepository) => Promise<Result>
    ) {
        return this.runOwnerOperation(
            async (current) => {
                const resolved = await durableAssetOwnerResolution.recovery(recoveryId);
                if (resolved.status === 'failed') {
                    return resolved;
                }
                return operation(
                    resolved.status === 'missing' || resolved.ownerId === this.ownerId
                        ? current
                        : createDurableAssetRepository(resolved.ownerId)
                );
            },
            { resumeRecoveries: false }
        );
    }

    /** Check if an asset is available locally. */
    hasAsset(hash: string): boolean {
        return this.localAssets.has(hash) || this.durableAssetCache.has(hash);
    }

    /** Get a local asset by hash. */
    getAsset(hash: string): Blob | undefined {
        return this.localAssets.get(hash)?.blob ?? this.durableAssetCache.get(hash)?.blob;
    }

    /**
     * Request a missing asset from connected peers.
     *
     * Idempotent while the request is alive: repeated calls for a hash that is
     * already held, already in flight, or still outstanding are dropped, so a
     * per-tick caller cannot flood the channel. Once a transfer aborts, the
     * hash becomes requestable again — that is what makes an interrupted asset
     * recoverable inside the same session — but only after
     * {@link ASSET_REQUEST_RETRY_COOLDOWN_MS}, and only for
     * {@link ASSET_REQUEST_MAX_ATTEMPTS} attempts in total. The caller is the
     * scheduler tick (~100/s), so this method owns the whole retry policy and
     * must stay a handful of lookups.
     */
    requestAsset(hash: string): void {
        if (this.disposed) {
            return;
        }
        if (
            this.localAssets.has(hash) ||
            this.durableAssetCache.has(hash) ||
            this.incomingTransfers.has(hash) ||
            this.requestedHashes.has(hash)
        ) {
            return;
        }
        if (this.abandonedHashes.has(hash)) {
            return;
        }
        const notBefore = this.retryNotBefore.get(hash);
        if (notBefore !== undefined && Date.now() < notBefore) {
            return;
        }

        // Mark the hash as outstanding so an incoming manifest for it is treated
        // as a solicited reply rather than an unsolicited transfer slot.
        this.requestedHashes.add(hash);
        this.armStallTimer(hash);

        const msg: AssetControlMessage = {
            type: 'asset.request',
            hash,
            missingChunks: [],
        };

        this.peerManager.broadcastCrdtSync({
            type: 'crdt-sync',
            docId: DOC_ID_ASSET,
            data: JSON.stringify(msg),
        });
    }

    /** Handle an incoming asset-related message. */
    async handleMessage(peerId: PeerId, message: PeerMessage): Promise<void> {
        if (this.disposed) {
            return;
        }
        if (message.type !== 'crdt-sync' || message.docId !== DOC_ID_ASSET) {
            return;
        }

        try {
            const data = JSON.parse(message.data) as AssetControlMessage;

            if (data.type === 'asset.request') {
                await this.handleAssetRequest(peerId, data.hash, data.missingChunks);
            } else if (data.type === 'asset.manifest') {
                this.handleManifest(peerId, data.manifest);
            } else if (data.type === 'asset.chunk') {
                this.handleChunk(data.hash, data.index, data.data);
            }
        } catch (error) {
            logger.warn('[AssetTransfer] Failed to handle message:', error);
        }
    }

    /** Arm (or re-arm) the no-progress deadline for one outstanding hash. */
    private armStallTimer(hash: string): void {
        if (this.disposed) {
            return;
        }
        this.clearStallTimer(hash);
        this.stallTimers.set(
            hash,
            setTimeout(() => {
                this.stallTimers.delete(hash);
                this.abortTransfer(hash, 'the sending peer stopped responding');
            }, ASSET_TRANSFER_STALL_TIMEOUT_MS)
        );
    }

    private clearStallTimer(hash: string): void {
        const timer = this.stallTimers.get(hash);
        if (timer !== undefined) {
            clearTimeout(timer);
            this.stallTimers.delete(hash);
        }
    }

    /**
     * End a solicited transfer that cannot complete: release its partial chunks
     * and its outstanding marker, then report the failure.
     *
     * Releasing the marker is the recovery seam — the hash becomes requestable
     * again, so one hostile or dead first-responder no longer makes the asset
     * permanently unfetchable for the rest of the session. Reporting is the
     * user-facing seam: an abandoned transfer used to be a `logger.warn` and
     * nothing else, leaving clips silently unplayable.
     *
     * Recovery is rate-limited, not free: the abort arms a cooldown and spends
     * one of the hash's attempts. Its caller is the per-tick scheduler, so an
     * uncooled re-open turns every immediately-aborting failure class into a
     * request/abort loop at peer-RTT speed.
     */
    private abortTransfer(hash: string, reason: string): void {
        if (this.disposed) {
            return;
        }
        this.clearStallTimer(hash);
        const wasOutstanding = this.requestedHashes.delete(hash);
        const wasInFlight = this.incomingTransfers.delete(hash);
        if (!wasOutstanding && !wasInFlight) {
            return;
        }

        const attempts = (this.failedAttempts.get(hash) ?? 0) + 1;
        this.failedAttempts.set(hash, attempts);
        if (attempts >= ASSET_REQUEST_MAX_ATTEMPTS) {
            this.abandonedHashes.add(hash);
            this.retryNotBefore.delete(hash);
        } else {
            this.retryNotBefore.set(hash, Date.now() + ASSET_REQUEST_RETRY_COOLDOWN_MS);
        }

        logger.warn(`[AssetTransfer] Transfer for ${hash} aborted: ${reason}`);
        this.callbacks.onTransferFailed(hash, reason);
    }

    private async handleAssetRequest(peerId: PeerId, hash: string, missingChunks: unknown): Promise<void> {
        // A request is a ~100-byte message; answering one slices, base64-encodes
        // and buffers the whole asset. Without an in-flight marker, N identical
        // requests are served N times concurrently, so the responder multiplies
        // the sender's cost by N — a bound on any single response cannot help.
        // Identical requests are dropped while one is serving (the response the
        // peer is already receiving is the answer); distinct hashes are capped.
        const serving = this.servingHashesByPeer.get(peerId) ?? new Set<string>();
        if (serving.has(hash) || serving.size >= MAX_CONCURRENT_ASSET_RESPONSES_PER_PEER) {
            return;
        }
        serving.add(hash);
        this.servingHashesByPeer.set(peerId, serving);
        try {
            const resident = this.localAssets.get(hash);
            if (resident) {
                await this.sendAssetResponse(peerId, hash, resident, missingChunks);
                return;
            }
            // A renderer/session restart has no resident entry. Only an
            // explicitly promoted project owner may reopen durable bytes;
            // ordinary local and received session assets never mint ownerIds.
            const durable = await this.runOwnerOperation((durableAssets) => durableAssets.reopenDurableAsset(hash));
            if (this.disposed) {
                return;
            }
            if (durable.status === 'failed') {
                this.durableAssetCache.delete(hash);
                return;
            }
            const entry = { blob: durable.blob, name: durable.name };
            this.durableAssetCache.set(hash, entry);
            await this.sendAssetResponse(peerId, hash, entry, missingChunks);
        } finally {
            serving.delete(hash);
            if (serving.size === 0) {
                this.servingHashesByPeer.delete(peerId);
            }
        }
    }

    private async sendAssetResponse(
        peerId: PeerId,
        hash: string,
        entry: DurableAssetCacheEntry,
        missingChunks: unknown
    ): Promise<void> {
        const { blob, name } = entry;
        const chunkCount = Math.ceil(blob.size / ASSET_CHUNK_SIZE);
        const manifest: AssetManifest = {
            hash,
            size: blob.size,
            chunkSize: ASSET_CHUNK_SIZE,
            chunkCount,
            name,
            mime: blob.type || 'application/octet-stream',
        };

        // The manifest must land before its chunks: a chunk for a hash with no
        // manifest is rejected by `handleChunk`.
        if (this.disposed) {
            return;
        }
        await this.peerManager.sendCrdtSync({
            peerId,
            message: {
                type: 'crdt-sync',
                docId: DOC_ID_ASSET,
                data: JSON.stringify({ type: 'asset.manifest', manifest } satisfies AssetControlMessage),
            },
        });

        // Send requested chunks (or all if none specified). `missingChunks` is
        // remote input: an unbounded, duplicate-laden or out-of-range list would
        // otherwise drive an arbitrarily long slice-encode-send loop on this
        // peer. Bound while filtering, never before: deduplicating first would
        // materialize a `Set` at the sender's declared cardinality, which the
        // CRDT framing lets reach tens of millions of elements.
        const chunksToSend = isNonEmptyIndexList(missingChunks)
            ? boundedChunkIndices(missingChunks, chunkCount)
            : Array.from({ length: chunkCount }, (_, index1) => index1);

        for (const index of chunksToSend) {
            if (this.disposed) {
                return;
            }
            const start = index * ASSET_CHUNK_SIZE;
            const end = Math.min(start + ASSET_CHUNK_SIZE, blob.size);
            const slice = blob.slice(start, end);
            const buffer = await slice.arrayBuffer();
            if (this.disposed) {
                return;
            }
            const base64 = arrayBufferToBase64(buffer);

            await this.peerManager.sendCrdtSyncBuffered({
                peerId,
                message: {
                    type: 'crdt-sync',
                    docId: DOC_ID_ASSET,
                    data: JSON.stringify({
                        type: 'asset.chunk',
                        hash,
                        index,
                        data: base64,
                    } satisfies AssetControlMessage),
                },
            });
        }
    }

    private handleManifest(_peerId: PeerId, manifest: AssetManifest): void {
        if (this.disposed) {
            return;
        }
        // Already have the asset — nothing to fetch.
        if (this.localAssets.has(manifest.hash) || this.durableAssetCache.has(manifest.hash)) {
            return;
        }

        // Ignore manifests for hashes this peer never requested. An incoming
        // manifest must answer an outstanding requestAsset, otherwise a remote
        // peer could spin up an arbitrary number of transfer slots we never
        // asked for (unsolicited-manifest memory DoS).
        if (!this.requestedHashes.has(manifest.hash)) {
            return;
        }

        // First-responder-wins: once a transfer is in flight for this hash, the
        // chosen manifest is locked in and later manifests (from other peers)
        // are ignored. Without this, every peer's manifest would overwrite the
        // slot and reset progress, fanning out the transfer to O(N) responders.
        if (this.incomingTransfers.has(manifest.hash)) {
            return;
        }

        // Reject manifests whose declared dimensions are inconsistent or
        // unbounded — these define the limits all later chunks are checked
        // against, so an untrustworthy manifest is itself a DoS vector.
        if (!isManifestSane(manifest)) {
            logger.warn(`[AssetTransfer] Rejecting malformed manifest for ${manifest.hash}`);
            return;
        }

        // The outstanding marker stays until the transfer terminates (see
        // `requestedHashes`); duplicate and stale manifests are already excluded
        // by the in-flight check above.
        this.incomingTransfers.set(manifest.hash, {
            manifest,
            chunks: new Map(),
            receivedBitmap: new Set(),
        });

        // Progress: restart the no-progress clock against the first chunk.
        this.armStallTimer(manifest.hash);
    }

    private handleChunk(hash: string, index: number, base64Data: unknown): void {
        if (this.disposed) {
            return;
        }
        // Reject chunks for a hash with no in-flight (requested) transfer. This
        // covers chunks arriving before/without a manifest, chunks from peers
        // that lost the first-responder race, and chunks for assets we already
        // hold or never asked for.
        const transfer = this.incomingTransfers.get(hash);
        if (!transfer) {
            return;
        }

        const { manifest } = transfer;

        // Reject out-of-range indices. A malicious peer could otherwise store
        // chunks at arbitrary indices (including indices >= chunkCount),
        // growing transfer.chunks without bound.
        if (!Number.isInteger(index) || index < 0 || index >= manifest.chunkCount) {
            this.abortTransfer(hash, `chunk ${index} is outside the declared range`);
            return;
        }

        // Bound the payload before decoding it, not after. Decoding allocates
        // the full chunk, so a payload that is certain to be refused still costs
        // its own decoded size first — repeatable at line rate. The encoded
        // length is an exact function of the decoded length, so the declared
        // chunk size can be enforced on the string itself.
        if (typeof base64Data !== 'string') {
            this.abortTransfer(hash, `chunk ${index} payload is not a string`);
            return;
        }
        if (base64Data.length > base64LengthFor(manifest.chunkSize)) {
            this.abortTransfer(hash, `chunk ${index} encodes more than the declared chunk size ${manifest.chunkSize}`);
            return;
        }

        let data: Uint8Array;
        try {
            data = base64ToBytes(base64Data);
        } catch {
            this.abortTransfer(hash, `chunk ${index} is not valid base64`);
            return;
        }

        // The encoded bound admits one trailing padding group, so the decoded
        // length is still checked exactly against the manifest.
        if (data.byteLength > manifest.chunkSize) {
            this.abortTransfer(
                hash,
                `chunk ${index} is ${data.byteLength} bytes, over the declared chunk size ${manifest.chunkSize}`
            );
            return;
        }

        // Whether this chunk is new decides whether the stall clock restarts: a
        // duplicate is not progress, and re-arming on one lets a peer replaying
        // a single already-received index below the deadline pin the transfer —
        // and with it the hash's outstanding marker — for the whole session.
        const receivedBefore = transfer.receivedBitmap.size;
        transfer.chunks.set(index, data);
        transfer.receivedBitmap.add(index);
        const progressed = transfer.receivedBitmap.size > receivedBefore;

        this.callbacks.onProgress(hash, transfer.receivedBitmap.size, manifest.chunkCount);

        if (transfer.receivedBitmap.size === manifest.chunkCount) {
            // Completion is single-shot: the slot is released before the async
            // assembly is dispatched, so a duplicate completing chunk arriving
            // during the digest finds no transfer instead of launching a second
            // full-size reassembly. The captured `transfer` carries the chunks.
            this.clearStallTimer(hash);
            this.incomingTransfers.delete(hash);
            void this.assembleAsset(hash, transfer);
            return;
        }

        if (progressed) {
            // Progress: restart the no-progress clock against the next chunk.
            this.armStallTimer(hash);
        }
    }

    /**
     * Turn a fully-received transfer into a verified local asset.
     *
     * The caller has already released the transfer slot and cleared the stall
     * timer, so nothing else will ever end this hash: every exit here must be
     * terminal *and* reported. A silent return would leave the hash outstanding
     * with no timer armed — unrecoverable even by the stall path — which is why
     * the missing-chunk case and every rejection (a digest or `arrayBuffer` over
     * a half-gigabyte blob can fail on memory alone) route through
     * `abortTransfer` rather than escaping under the caller's `void`.
     */
    private async assembleAsset(
        hash: string,
        transfer: {
            manifest: AssetManifest;
            chunks: Map<number, Uint8Array>;
        }
    ): Promise<void> {
        try {
            const sortedChunks: Uint8Array[] = [];
            for (let index = 0; index < transfer.manifest.chunkCount; index++) {
                const chunk = transfer.chunks.get(index);
                if (!chunk) {
                    this.abortTransfer(hash, `chunk ${index} was missing at assembly`);
                    return;
                }
                sortedChunks.push(chunk);
            }

            const totalSize = sortedChunks.reduce((sum, context) => sum + context.length, 0);
            const assembled = new Uint8Array(totalSize);
            let offset = 0;
            for (const chunk of sortedChunks) {
                assembled.set(chunk, offset);
                offset += chunk.length;
            }

            const blob = new Blob([assembled], { type: transfer.manifest.mime });

            // Verify integrity before accepting the asset.
            const actualHash = await hashBlob(blob);
            if (this.disposed) {
                return;
            }
            if (actualHash !== hash) {
                this.abortTransfer(hash, `integrity check failed (received ${actualHash})`);
                return;
            }

            // Received session bytes stay resident only. Durable ownerIds are
            // minted exclusively by explicit hash-bound stage/promotion; a
            // transfer has no project reachability authority to retain them.
            this.localAssets.set(hash, {
                blob,
                name: transfer.manifest.name,
                durable: true,
                stagingLeaseIds: new Set(),
            });
            this.clearStallTimer(hash);
            this.requestedHashes.delete(hash);
            // The asset resolved, so the hash owes nothing to the retry policy.
            this.retryNotBefore.delete(hash);
            this.failedAttempts.delete(hash);
            this.callbacks.onAssetAvailable(hash);
        } catch (error) {
            this.abortTransfer(hash, `assembly failed (${describeError(error)})`);
        }
    }
}

/** Message text for a caught unknown, without laundering it through a cast. */
function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * Encoded length of `byteLength` bytes of base64: four characters per
 * three-byte group, the last group padded. Exact, so it bounds a chunk payload
 * before decoding without refusing any legally-sized one.
 */
function base64LengthFor(byteLength: number): number {
    return 4 * Math.ceil(byteLength / 3);
}

/**
 * Collect the chunk indices a requester actually asked for, bounded as they are
 * read.
 *
 * The input is remote and its length is only bounded by the CRDT channel's
 * reassembly ceiling — tens of millions of elements. Retention is therefore
 * capped at `chunkCount` entries regardless of input length, and the pass stops
 * as soon as the whole asset is covered.
 */
function boundedChunkIndices(requested: readonly unknown[], chunkCount: number): number[] {
    const selected = new Set<number>();
    for (const value of requested) {
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value >= chunkCount) {
            continue;
        }
        selected.add(value);
        if (selected.size === chunkCount) {
            break;
        }
    }
    return [...selected];
}

/**
 * Whether a remote-supplied `missingChunks` field is a list worth reading. Its
 * elements stay `unknown`: they are validated one at a time in
 * {@link boundedChunkIndices}, never trusted in bulk.
 */
function isNonEmptyIndexList(value: unknown): value is readonly unknown[] {
    return Array.isArray(value) && value.length > 0;
}

/**
 * Validate a manifest's declared dimensions before committing to a transfer.
 *
 * The manifest is attacker-controlled: every later chunk is bounds-checked
 * against `chunkCount` and `chunkSize`, so an inconsistent or unbounded
 * manifest is itself a memory-DoS vector. Reject anything non-integral,
 * negative, mutually inconsistent, outside the accepted chunk-size range, or
 * over the hard size ceiling — plus any metadata string a sender could inflate,
 * since the name is retained with the assembled asset.
 */
function isManifestSane(manifest: AssetManifest): boolean {
    const { size, chunkSize, chunkCount, name, mime } = manifest;

    if (typeof name !== 'string' || name.length > MAX_ASSET_NAME_LEN) {
        return false;
    }
    if (typeof mime !== 'string' || mime.length > MAX_ASSET_MIME_LEN) {
        return false;
    }
    // Size 0 is refused rather than accepted: a zero-byte asset yields
    // `chunkCount: 0`, and completion is only ever evaluated when a chunk lands,
    // so such a transfer could not finish — it would occupy a slot until the
    // stall deadline and then abort. No sender this app runs mints one.
    if (!Number.isInteger(size) || size <= 0 || size > MAX_ASSET_SIZE) {
        return false;
    }
    // Bounded from both ends: the ceiling stops one chunk from claiming the
    // whole byte budget, and the floor stops a `chunkSize: 1` manifest from
    // declaring one Map+Set slot per byte of an otherwise legal size.
    if (!Number.isInteger(chunkSize) || chunkSize < MIN_ASSET_CHUNK_SIZE || chunkSize > MAX_ASSET_CHUNK_SIZE) {
        return false;
    }
    if (!Number.isInteger(chunkCount) || chunkCount < 1) {
        return false;
    }
    // chunkCount must be exactly the number of chunkSize-sized pieces that
    // cover `size`, so a manifest can't declare more chunks than its size needs.
    if (chunkCount !== Math.ceil(size / chunkSize)) {
        return false;
    }
    return true;
}

/** Hash a blob using SHA-256 (browser-native). BLAKE3 can be added via wasm. */
async function hashBlob(blob: Blob): Promise<string> {
    const buffer = await blob.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return `sha256:${hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
    return bytesToBase64(new Uint8Array(buffer));
}
