/**
 * The wire shapes `crates/sourdaw-native/src/commands/agent_asset_saga.rs` sends and receives.
 *
 * Hand-written on both sides — no binding generator runs — so a change to a body's serde types is
 * only complete once these mirror it. Field names are the serde `camelCase` spellings, and the
 * string unions are the serde `kebab-case` variant names; anything else deserializes into a shape
 * the guard below rejects rather than into a silently wrong value.
 */

/** The caller's work identity, echoed back unchanged in every receipt. */
export type AgentWorkOwner = {
    readonly runId: string;
    readonly workId: string;
    readonly leaseId: string;
    readonly cancellationGeneration: number;
};

/** What a handle permits. A read handle can never back a write. */
export type AssetHandleMode = 'read' | 'read-write';

/** Which command produced a receipt. */
export type AgentAssetSagaOperation = 'register-handle' | 'import' | 'stage-export' | 'finalize-export' | 'cleanup';

/**
 * Where an effect got to. `external-pending` means the bytes are staged and verified but nothing
 * outside the native process has seen them, so the saga is neither done nor undone.
 */
export type AgentAssetSagaState = 'committed' | 'external-pending' | 'failed' | 'refused';

/** What undoing the effect would still take. */
export type AgentAssetCompensation = 'not-needed' | 'available' | 'completed';

/** Why an effect did not reach its state. */
export type AgentAssetFailureKind =
    | 'handle-unknown'
    | 'access-denied'
    | 'metadata-mismatch'
    | 'verification-failed'
    | 'authorization-required'
    | 'already-owned'
    | 'io-error';

/** What the asset's own bytes say it is. A field is null when the bytes did not answer it. */
export type AgentAssetMetadata = {
    readonly byteLength: number;
    readonly format: string | null;
    readonly sampleRate: number | null;
    readonly channels: number | null;
    readonly frameCount: number | null;
};

/**
 * What the caller believes the bytes are. Every field is optional, and each one supplied is checked
 * against the derived value — a disagreement refuses the import rather than registering the
 * caller's version of it.
 */
export type AgentAssetDeclaredMetadata = {
    readonly byteLength?: number;
    readonly format?: string;
    readonly sampleRate?: number;
    readonly channels?: number;
};

/** Whether the caller has authority to replace a destination that already exists. */
export type AgentAssetExportAuthorization = {
    readonly overwrite: boolean;
};

/** One command's answer: what was attempted, what state it reached, and what can still be done. */
export type AgentAssetSagaReceipt = {
    readonly sagaId: string;
    readonly owner: AgentWorkOwner;
    readonly operation: AgentAssetSagaOperation;
    readonly state: AgentAssetSagaState;
    readonly compensation: AgentAssetCompensation;
    readonly handleId: string | null;
    readonly assetId: string | null;
    readonly contentHash: string | null;
    readonly metadata: AgentAssetMetadata | null;
    readonly failure: AgentAssetFailureKind | null;
    readonly message: string | null;
    readonly finalizeOwner: string | null;
    readonly cleanupOwner: string | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const isOwner = (value: unknown): value is AgentWorkOwner =>
    isRecord(value) &&
    typeof value.runId === 'string' &&
    typeof value.workId === 'string' &&
    typeof value.leaseId === 'string' &&
    typeof value.cancellationGeneration === 'number';

/**
 * Whether a payload is a receipt at all.
 *
 * Structural rather than exhaustive, and it checks exactly the four fields every command answers
 * with: without a saga id, an owner, a state and a compensation there is nothing a caller can
 * decide from, so a payload missing any of them is a broken contract rather than a receipt
 * reporting a failure.
 */
export function isAgentAssetSagaReceipt(value: unknown): value is AgentAssetSagaReceipt {
    return (
        isRecord(value) &&
        typeof value.sagaId === 'string' &&
        isOwner(value.owner) &&
        typeof value.state === 'string' &&
        typeof value.compensation === 'string'
    );
}
