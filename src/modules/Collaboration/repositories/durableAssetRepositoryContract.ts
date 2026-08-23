import { type LeaseState } from './durableAssetIndexedDb';

export type DurableAsset = { hash: string; blob: Blob; name: string };
export type DurableAssetFailure = {
    status: 'failed';
    reason:
        | 'unknown-lease'
        | 'lease-owner-mismatch'
        | 'lease-hash-mismatch'
        | 'missing-asset'
        | 'stored-hash-mismatch'
        | 'corrupt-record'
        | 'lease-terminal-conflict'
        | 'asset-not-owned'
        | 'owner-handoff-conflict';
};
export type ReopenStagedAssetResult =
    | ({ status: 'opened'; leaseId: string; leaseState: Exclude<LeaseState, 'released'> } & DurableAsset)
    | DurableAssetFailure;
export type ReopenDurableAssetResult = ({ status: 'opened' } & DurableAsset) | DurableAssetFailure;
export type PromoteStagedAssetResult =
    ({ status: 'promoted' | 'already-promoted'; leaseId: string } & DurableAsset) | DurableAssetFailure;
export type ReleaseStagedAssetResult =
    | {
          status: 'released' | 'already-released';
          leaseId: string;
          hash: string;
          assetRemoved: boolean;
          ownerRetained: boolean;
      }
    | DurableAssetFailure;
export type StagedAssetBinding = { leaseId: string; expectedHash: string };
export type ReleasedStagedAsset = Exclude<ReleaseStagedAssetResult, DurableAssetFailure>;
export type ReleaseStagedAssetsResult = { status: 'released'; releases: ReleasedStagedAsset[] } | DurableAssetFailure;
export type ReleaseOwnedAssetResult = { status: 'released'; hash: string; assetRemoved: boolean } | DurableAssetFailure;
export type RebindDurableAssetOwnerResult =
    { status: 'rebound'; previousOwnerId: string; ownerId: string; reboundHashes: string[] } | DurableAssetFailure;
export type PrepareDurableAssetOwnerHandoffResult =
    { status: 'prepared'; previousOwnerId: string; ownerId: string } | DurableAssetFailure;
export type ResumeDurableAssetOwnerHandoffsResult =
    { status: 'resumed'; ownerId: string; handoffCount: number; reboundHashes: string[] } | DurableAssetFailure;
export type ReleaseDurableAssetOwnerResult = {
    status: 'released';
    ownerId: string;
    releasedHashes: string[];
    removedAssets: number;
    compactedLeases: number;
};

export type AssetInvalidation = { hash: string; ownerId?: string };

export type DurableAssetRepository = {
    stageAsset: (leaseId: string, blob: Blob, name: string) => Promise<DurableAsset & { leaseId: string }>;
    reopenStagedAsset: (leaseId: string, expectedHash: string) => Promise<ReopenStagedAssetResult>;
    reopenDurableAsset: (hash: string) => Promise<ReopenDurableAssetResult>;
    promoteStagedAsset: (leaseId: string, expectedHash: string) => Promise<PromoteStagedAssetResult>;
    releaseStagedAsset: (leaseId: string, expectedHash: string) => Promise<ReleaseStagedAssetResult>;
    releaseStagedAssets: (bindings: readonly StagedAssetBinding[]) => Promise<ReleaseStagedAssetsResult>;
    releaseOwnedAsset: (hash: string) => Promise<ReleaseOwnedAssetResult>;
    releaseOwner: () => Promise<ReleaseDurableAssetOwnerResult>;
    prepareOwnerRebind: (nextOwnerId: string) => Promise<PrepareDurableAssetOwnerHandoffResult>;
    commitOwnerRebind: (nextOwnerId: string) => Promise<RebindDurableAssetOwnerResult>;
    resumeOwnerRebinds: () => Promise<ResumeDurableAssetOwnerHandoffsResult>;
    subscribeInvalidation: (listener: (event: AssetInvalidation) => void) => () => void;
};
