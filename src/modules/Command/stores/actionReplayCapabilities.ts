import { type AppAction } from '#/utils/handlerContract';

import { bumpActionReplayRevision } from './actionReplayRevisionStore';

const MAX_ACTION_REPLAY_CAPABILITIES = 200;
const MAX_ACTION_REPLAY_TOMBSTONES = 200;

type ActionReplayClaim = {
    readonly inverseAction: AppAction;
    readonly generation: number;
    readonly entryEpoch: number;
    readonly metadataFingerprint: string;
};

type ActionReplayMetadata = {
    readonly id: string;
    readonly label: string;
    readonly actionKind: string;
    readonly source: 'manual' | 'prompt' | 'voice' | 'ai';
    readonly timestamp: number;
    readonly groupId?: string;
    readonly groupLabel?: string;
};

type ActionReplayActiveRecord = {
    readonly state: 'available' | 'claimed' | 'pending-mark';
    readonly claim: ActionReplayClaim;
};

const action_replay_capabilities = new Map<string, ActionReplayActiveRecord>();
const action_replay_tombstones = new Map<string, number>();
let action_replay_generation = 0;
let next_action_replay_entry_epoch = 0;

type RegisterActionReplayCapabilityInput = {
    entryId: string;
    inverseAction: AppAction;
    metadata: ActionReplayMetadata;
};

function pruneActionReplayCapabilities(): void {
    while (action_replay_capabilities.size > MAX_ACTION_REPLAY_CAPABILITIES) {
        const oldest_entry_id = action_replay_capabilities.keys().next().value;
        if (oldest_entry_id === undefined) {
            return;
        }
        action_replay_capabilities.delete(oldest_entry_id);
    }
}

function pruneActionReplayTombstones(): void {
    while (action_replay_tombstones.size > MAX_ACTION_REPLAY_TOMBSTONES) {
        const oldest_entry_id = action_replay_tombstones.keys().next().value;
        if (oldest_entry_id === undefined) {
            return;
        }
        action_replay_tombstones.delete(oldest_entry_id);
    }
}

function advanceActionReplayEntryEpoch(): number {
    next_action_replay_entry_epoch += 1;
    return next_action_replay_entry_epoch;
}

type HasMatchingClaimInput = {
    record: ActionReplayActiveRecord;
    claim: ActionReplayClaim;
};

function hasMatchingClaim({ record, claim }: HasMatchingClaimInput): boolean {
    return record.claim.generation === claim.generation && record.claim.entryEpoch === claim.entryEpoch;
}

function getActionReplayMetadataFingerprint(metadata: ActionReplayMetadata): string {
    return JSON.stringify([
        metadata.id,
        metadata.label,
        metadata.actionKind,
        metadata.source,
        metadata.timestamp,
        metadata.groupId ?? null,
        metadata.groupLabel ?? null,
    ]);
}

export function registerActionReplayCapability({
    entryId,
    inverseAction,
    metadata,
}: RegisterActionReplayCapabilityInput): void {
    registerActionReplayCapabilities([{ entryId, inverseAction, metadata }]);
}

export function registerActionReplayCapabilities(inputs: readonly RegisterActionReplayCapabilityInput[]): void {
    if (inputs.length === 0) {
        return;
    }
    for (const { entryId, inverseAction, metadata } of inputs) {
        action_replay_capabilities.delete(entryId);
        action_replay_tombstones.delete(entryId);
        action_replay_capabilities.set(entryId, {
            state: 'available',
            claim: {
                inverseAction,
                generation: action_replay_generation,
                entryEpoch: advanceActionReplayEntryEpoch(),
                metadataFingerprint: getActionReplayMetadataFingerprint(metadata),
            },
        });
    }
    pruneActionReplayCapabilities();
    bumpActionReplayRevision();
}

export function hasActionReplayCapability(entryId: string): boolean {
    return action_replay_capabilities.get(entryId)?.state === 'available';
}

type ClaimActionReplayCapabilityInput = {
    entryId: string;
    metadata: ActionReplayMetadata;
};

export function claimActionReplayCapability({
    entryId,
    metadata,
}: ClaimActionReplayCapabilityInput): ActionReplayClaim | null {
    const record = action_replay_capabilities.get(entryId);
    if (
        record?.state !== 'available' ||
        record.claim.metadataFingerprint !== getActionReplayMetadataFingerprint(metadata)
    ) {
        return null;
    }

    action_replay_capabilities.set(entryId, { state: 'claimed', claim: record.claim });
    bumpActionReplayRevision();
    return record.claim;
}

type HasCurrentActionReplayCapabilityInput = {
    entryId: string;
    metadata: ActionReplayMetadata;
};

export function hasCurrentActionReplayCapability({
    entryId,
    metadata,
}: HasCurrentActionReplayCapabilityInput): boolean {
    const record = action_replay_capabilities.get(entryId);
    return (
        record?.state === 'available' &&
        record.claim.metadataFingerprint === getActionReplayMetadataFingerprint(metadata)
    );
}

export function syncActionReplayCapabilityMetadata(entries: readonly ActionReplayMetadata[]): void {
    const entries_by_id = new Map(entries.map((entry) => [entry.id, entry]));
    for (const [entry_id, record] of action_replay_capabilities) {
        const current = entries_by_id.get(entry_id);
        if (current === undefined || record.claim.metadataFingerprint !== getActionReplayMetadataFingerprint(current)) {
            revokeActionReplayCapability(entry_id);
        }
    }
}

type RestoreActionReplayCapabilityInput = {
    entryId: string;
    claim: ActionReplayClaim;
};

export function restoreActionReplayCapability({ entryId, claim }: RestoreActionReplayCapabilityInput): void {
    if (claim.generation !== action_replay_generation || action_replay_tombstones.has(entryId)) {
        return;
    }

    const record = action_replay_capabilities.get(entryId);
    if (record === undefined || record.state !== 'claimed' || !hasMatchingClaim({ record, claim })) {
        return;
    }

    action_replay_capabilities.set(entryId, { state: 'available', claim });
    bumpActionReplayRevision();
}

export function revokeActionReplayCapability(entryId: string): void {
    action_replay_capabilities.delete(entryId);
    action_replay_tombstones.delete(entryId);
    action_replay_tombstones.set(entryId, advanceActionReplayEntryEpoch());
    pruneActionReplayTombstones();
    bumpActionReplayRevision();
}

type ConsumeActionReplayClaimInput = {
    entryId: string;
    claim: ActionReplayClaim;
};

export function isActionReplayClaimCurrent({ entryId, claim }: ConsumeActionReplayClaimInput): boolean {
    if (claim.generation !== action_replay_generation) {
        return false;
    }

    const record = action_replay_capabilities.get(entryId);
    return record?.state === 'claimed' && hasMatchingClaim({ record, claim });
}

export function consumeActionReplayClaim({ entryId, claim }: ConsumeActionReplayClaimInput): void {
    const record = action_replay_capabilities.get(entryId);
    if (record === undefined || record.state !== 'claimed' || !hasMatchingClaim({ record, claim })) {
        return;
    }

    action_replay_capabilities.delete(entryId);
    bumpActionReplayRevision();
}

type RetainActionReplayMarkReconciliationInput = {
    entryId: string;
    claim: ActionReplayClaim;
};

export function retainActionReplayMarkReconciliation({
    entryId,
    claim,
}: RetainActionReplayMarkReconciliationInput): void {
    if (claim.generation !== action_replay_generation) {
        return;
    }

    const record = action_replay_capabilities.get(entryId);
    if (record === undefined || record.state !== 'claimed' || !hasMatchingClaim({ record, claim })) {
        return;
    }

    action_replay_capabilities.set(entryId, { state: 'pending-mark', claim });
    bumpActionReplayRevision();
}

type GetActionReplayMarkReconciliationInput = {
    entryId: string;
    metadata: ActionReplayMetadata;
};

export function getActionReplayMarkReconciliation({
    entryId,
    metadata,
}: GetActionReplayMarkReconciliationInput): ActionReplayClaim | null {
    const record = action_replay_capabilities.get(entryId);
    if (
        record?.state !== 'pending-mark' ||
        record.claim.metadataFingerprint !== getActionReplayMetadataFingerprint(metadata)
    ) {
        return null;
    }
    return record.claim;
}

export function completeActionReplayMarkReconciliation(entryId: string): void {
    if (action_replay_capabilities.get(entryId)?.state !== 'pending-mark') {
        return;
    }

    action_replay_capabilities.delete(entryId);
    bumpActionReplayRevision();
}

export function clearActionReplayCapabilities(): void {
    action_replay_generation += 1;
    action_replay_capabilities.clear();
    action_replay_tombstones.clear();
    bumpActionReplayRevision();
}
