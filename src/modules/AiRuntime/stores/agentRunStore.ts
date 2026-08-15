import { createStore } from '#/infra/store/createStore';
import { createLocalStorage } from '#/infra/store/storage/createLocalStorage';

import { AGENT_EXECUTION_MODES } from '../models/AgentExecutionMode';
import {
    AGENT_RUN_PHASES,
    AGENT_RUN_SCHEMA_VERSION,
    type AgentRun,
    type AgentRunArtifact,
    type AgentRunBatch,
    type AgentRunCommittedWork,
    type AgentRunError,
    type AgentRunProviderUsage,
    type AgentRunReceipt,
    type AgentRunRetriableWork,
    type AgentRunState,
    type AgentRunTemporaryAsset,
    type AgentRunWorkLease,
} from '../models/AgentRun';

const MAX_RUNS = 50;
const MAX_COLLECTION_LENGTH = 256;
const MAX_TEXT_LENGTH = 128 * 1024;

type UnknownRecord = Record<string, unknown>;

function createEmptyAgentRunState(): AgentRunState {
    return { schemaVersion: AGENT_RUN_SCHEMA_VERSION, runs: [] };
}

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 && value.length <= MAX_TEXT_LENGTH ? value : null;
}

function readNullableString(value: unknown): string | null | undefined {
    if (value === null) {
        return null;
    }
    const parsed = readString(value);
    return parsed ?? undefined;
}

function readTimestamp(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function readNullableTimestamp(value: unknown): number | null | undefined {
    if (value === null) {
        return null;
    }
    const parsed = readTimestamp(value);
    return parsed ?? undefined;
}

function readNonNegativeInteger(value: unknown): number | null {
    return Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : null;
}

function readStringArray(value: unknown): string[] | null {
    if (!Array.isArray(value) || value.length > MAX_COLLECTION_LENGTH) {
        return null;
    }
    const result: string[] = [];
    for (const item of value) {
        const parsed = readString(item);
        if (parsed === null) {
            return null;
        }
        result.push(parsed);
    }
    return result;
}

function readNumberRecord(value: unknown): Record<string, number> | null {
    if (!isRecord(value) || Object.keys(value).length > MAX_COLLECTION_LENGTH) {
        return null;
    }
    const result: Record<string, number> = {};
    for (const [key, candidate] of Object.entries(value)) {
        const parsedKey = readString(key);
        if (parsedKey === null || typeof candidate !== 'number' || !Number.isFinite(candidate) || candidate < 0) {
            return null;
        }
        result[parsedKey] = candidate;
    }
    return result;
}

function readRanges(value: unknown): Array<{ startBeat: number; endBeat: number }> | null {
    if (!Array.isArray(value) || value.length > MAX_COLLECTION_LENGTH) {
        return null;
    }
    const ranges: Array<{ startBeat: number; endBeat: number }> = [];
    for (const candidate of value) {
        if (
            !isRecord(candidate) ||
            typeof candidate.startBeat !== 'number' ||
            !Number.isFinite(candidate.startBeat) ||
            typeof candidate.endBeat !== 'number' ||
            !Number.isFinite(candidate.endBeat) ||
            candidate.endBeat <= candidate.startBeat
        ) {
            return null;
        }
        ranges.push({ startBeat: candidate.startBeat, endBeat: candidate.endBeat });
    }
    return ranges;
}

function readBatch(value: unknown): AgentRunBatch | null {
    if (!isRecord(value)) {
        return null;
    }
    const batchId = readString(value.batchId);
    const commandIds = readStringArray(value.commandIds);
    const receiptIdentity = readNullableString(value.receiptIdentity);
    const statuses: AgentRunBatch['status'][] = [
        'planned',
        'waiting-for-approval',
        'previewed',
        'executing',
        'committed',
        'no-op',
        'failed',
        'cancelled',
    ];
    if (
        batchId === null ||
        commandIds === null ||
        receiptIdentity === undefined ||
        !statuses.some((status) => status === value.status)
    ) {
        return null;
    }
    return { batchId, commandIds, status: value.status as AgentRunBatch['status'], receiptIdentity };
}

function readReceipt(value: unknown): AgentRunReceipt | null {
    if (!isRecord(value)) {
        return null;
    }
    const workId = readString(value.workId);
    const receiptIdentity = readString(value.receiptIdentity);
    const revertGroupId = readNullableString(value.revertGroupId);
    const committedAt = readTimestamp(value.committedAt);
    if (workId === null || receiptIdentity === null || revertGroupId === undefined || committedAt === null) {
        return null;
    }
    return { workId, receiptIdentity, revertGroupId, committedAt };
}

function readArtifact(value: unknown): AgentRunArtifact | null {
    if (!isRecord(value)) {
        return null;
    }
    const artifactId = readString(value.artifactId);
    const workId = readString(value.workId);
    const summary = readNullableString(value.summary);
    const statuses: AgentRunArtifact['status'][] = ['pending', 'completed', 'failed'];
    if (
        artifactId === null ||
        workId === null ||
        summary === undefined ||
        !statuses.some((status) => status === value.status)
    ) {
        return null;
    }
    return { artifactId, workId, status: value.status as AgentRunArtifact['status'], summary };
}

function readProviderUsage(value: unknown): AgentRunProviderUsage | null {
    if (!isRecord(value)) {
        return null;
    }
    const provider = readString(value.provider);
    const model = readNullableString(value.model);
    const inputTokens = value.inputTokens === null ? null : readNonNegativeInteger(value.inputTokens);
    const outputTokens = value.outputTokens === null ? null : readNonNegativeInteger(value.outputTokens);
    const provenances: AgentRunProviderUsage['provenance'][] = [
        'provider-reported',
        'versioned-estimate',
        'unavailable',
    ];
    const correlationId = value.correlationId === undefined ? undefined : readString(value.correlationId);
    const statuses: NonNullable<AgentRunProviderUsage['status']>[] = [
        'complete',
        'partial',
        'failed',
        'cancelled',
        'unavailable',
    ];
    const status = value.status === undefined ? undefined : statuses.find((candidate) => candidate === value.status);
    const retryableIsValid =
        value.retryable === undefined || value.retryable === null || typeof value.retryable === 'boolean';
    const retryable = retryableIsValid ? (value.retryable as boolean | null | undefined) : undefined;
    const partialOutputDispositions: NonNullable<AgentRunProviderUsage['partialOutputDisposition']>[] = [
        'none',
        'preserve',
        'discard',
    ];
    const partialOutputDisposition =
        value.partialOutputDisposition === undefined
            ? undefined
            : partialOutputDispositions.find((candidate) => candidate === value.partialOutputDisposition);
    if (
        provider === null ||
        model === undefined ||
        (inputTokens === null && value.inputTokens !== null) ||
        (outputTokens === null && value.outputTokens !== null) ||
        !provenances.some((provenance) => provenance === value.provenance) ||
        correlationId === null ||
        (value.status !== undefined && status === undefined) ||
        !retryableIsValid ||
        (value.partialOutputDisposition !== undefined && partialOutputDisposition === undefined)
    ) {
        return null;
    }
    return {
        provider,
        model,
        inputTokens,
        outputTokens,
        provenance: value.provenance as AgentRunProviderUsage['provenance'],
        ...(correlationId === undefined ? {} : { correlationId }),
        ...(status === undefined ? {} : { status }),
        ...(retryable === undefined ? {} : { retryable }),
        ...(partialOutputDisposition === undefined ? {} : { partialOutputDisposition }),
    };
}

function readError(value: unknown): AgentRunError | null {
    if (!isRecord(value)) {
        return null;
    }
    const code = readString(value.code);
    const message = readString(value.message);
    const occurredAt = readTimestamp(value.occurredAt);
    const workId = readNullableString(value.workId);
    if (
        code === null ||
        message === null ||
        occurredAt === null ||
        typeof value.retriable !== 'boolean' ||
        workId === undefined
    ) {
        return null;
    }
    return { code, message, occurredAt, retriable: value.retriable, workId };
}

function readCommittedWork(value: unknown): AgentRunCommittedWork | null {
    return readReceipt(value);
}

function readRetriableWork(value: unknown): AgentRunRetriableWork | null {
    if (!isRecord(value)) {
        return null;
    }
    const workId = readString(value.workId);
    const idempotencyKey = readString(value.idempotencyKey);
    const receiptIdentity = readString(value.receiptIdentity);
    if (
        workId === null ||
        idempotencyKey === null ||
        receiptIdentity === null ||
        typeof value.idempotent !== 'boolean' ||
        typeof value.retriable !== 'boolean'
    ) {
        return null;
    }
    return {
        workId,
        idempotencyKey,
        receiptIdentity,
        idempotent: value.idempotent,
        retriable: value.retriable,
    };
}

function readTemporaryAsset(value: unknown): AgentRunTemporaryAsset | null {
    if (!isRecord(value)) {
        return null;
    }
    const assetId = readString(value.assetId);
    const cleanupOwner = readString(value.cleanupOwner);
    const createdAt = readTimestamp(value.createdAt);
    const kinds: AgentRunTemporaryAsset['kind'][] = ['render', 'analysis', 'import', 'other'];
    const statuses: AgentRunTemporaryAsset['status'][] = ['live', 'cleanup-pending', 'released'];
    if (
        assetId === null ||
        cleanupOwner === null ||
        createdAt === null ||
        !kinds.some((kind) => kind === value.kind) ||
        !statuses.some((status) => status === value.status)
    ) {
        return null;
    }
    return {
        assetId,
        kind: value.kind as AgentRunTemporaryAsset['kind'],
        cleanupOwner,
        status: value.status as AgentRunTemporaryAsset['status'],
        createdAt,
    };
}

function readWorkLease(value: unknown): AgentRunWorkLease | null {
    if (!isRecord(value)) {
        return null;
    }
    const runId = readString(value.runId);
    const leaseId = readString(value.leaseId);
    const workId = readString(value.workId);
    const attempt = readNonNegativeInteger(value.attempt);
    const idempotencyKey = readString(value.idempotencyKey);
    const receiptIdentity = readString(value.receiptIdentity);
    const cleanupOwner = readString(value.cleanupOwner);
    const cancellationGeneration = readNonNegativeInteger(value.cancellationGeneration);
    const claimedAt = readTimestamp(value.claimedAt);
    const settledAt = readNullableTimestamp(value.settledAt);
    const ownerKinds: AgentRunWorkLease['ownerKind'][] = ['provider', 'command', 'render', 'analysis', 'cleanup'];
    const terminalStates: Array<Exclude<AgentRunWorkLease['terminalState'], null>> = [
        'completed',
        'failed',
        'cancelled',
        'orphaned',
    ];
    const terminalState =
        value.terminalState === null
            ? null
            : (terminalStates.find((candidate) => candidate === value.terminalState) ?? undefined);
    if (
        leaseId === null ||
        runId === null ||
        workId === null ||
        attempt === null ||
        attempt < 1 ||
        idempotencyKey === null ||
        receiptIdentity === null ||
        cleanupOwner === null ||
        cancellationGeneration === null ||
        claimedAt === null ||
        settledAt === undefined ||
        terminalState === undefined ||
        typeof value.idempotent !== 'boolean' ||
        typeof value.retriable !== 'boolean' ||
        !ownerKinds.some((ownerKind) => ownerKind === value.ownerKind)
    ) {
        return null;
    }
    return {
        leaseId,
        runId,
        workId,
        attempt,
        ownerKind: value.ownerKind as AgentRunWorkLease['ownerKind'],
        cancellationGeneration,
        idempotencyKey,
        receiptIdentity,
        cleanupOwner,
        idempotent: value.idempotent,
        retriable: value.retriable,
        claimedAt,
        terminalState,
        settledAt,
    };
}

function readCollection<TItem>(value: unknown, readItem: (candidate: unknown) => TItem | null): TItem[] | null {
    if (!Array.isArray(value) || value.length > MAX_COLLECTION_LENGTH) {
        return null;
    }
    const result: TItem[] = [];
    for (const candidate of value) {
        const item = readItem(candidate);
        if (item === null) {
            return null;
        }
        result.push(item);
    }
    return result;
}

function readAgentRun(value: unknown): AgentRun | null {
    if (!isRecord(value) || value.schemaVersion !== AGENT_RUN_SCHEMA_VERSION) {
        return null;
    }
    const runId = readString(value.runId);
    const request = readString(value.request);
    const createdAt = readTimestamp(value.createdAt);
    const updatedAt = readTimestamp(value.updatedAt);
    const mode = AGENT_EXECUTION_MODES.find((candidate) => candidate === value.mode);
    const phase = AGENT_RUN_PHASES.find((candidate) => candidate === value.phase);
    if (
        runId === null ||
        request === null ||
        createdAt === null ||
        updatedAt === null ||
        mode === undefined ||
        phase === undefined ||
        !isRecord(value.revisions) ||
        !isRecord(value.scope) ||
        !isRecord(value.grants) ||
        !isRecord(value.budgets) ||
        !isRecord(value.cancellation) ||
        !isRecord(value.manualResume)
    ) {
        return null;
    }
    const createdRevision = readNullableString(value.revisions.created);
    const plannedRevision = readNullableString(value.revisions.planned);
    const approvedRevision = readNullableString(value.revisions.approved);
    const committedRevision = readNullableString(value.revisions.committed);
    const targetIds = readStringArray(value.scope.targetIds);
    const targetRanges = readRanges(value.scope.targetRanges);
    const protectedTargetIds = readStringArray(value.scope.protectedTargetIds);
    const protectedRanges = readRanges(value.scope.protectedRanges);
    const allowedOperationPrefixes = readStringArray(value.grants.allowedOperationPrefixes);
    const limits = readNumberRecord(value.budgets.limits);
    const consumed = readNumberRecord(value.budgets.consumed);
    const plan = (() => {
        if (value.plan === null) {
            return null;
        }
        if (!isRecord(value.plan)) {
            return undefined;
        }
        const summary = readString(value.plan.summary);
        const commandIds = readStringArray(value.plan.commandIds);
        const serializedBatchIdentity = readNullableString(value.plan.serializedBatchIdentity);
        return summary === null || commandIds === null || serializedBatchIdentity === undefined
            ? undefined
            : { summary, commandIds, serializedBatchIdentity };
    })();
    const batches = readCollection(value.batches, readBatch);
    const receipts = readCollection(value.receipts, readReceipt);
    const renders = readCollection(value.renders, readArtifact);
    const analyses = readCollection(value.analyses, readArtifact);
    const providerUsage = readCollection(value.providerUsage, readProviderUsage);
    const errors = readCollection(value.errors, readError);
    const committedWork = readCollection(value.committedWork, readCommittedWork);
    const retriableWork = readCollection(value.retriableWork, readRetriableWork);
    const temporaryAssets = readCollection(value.temporaryAssets, readTemporaryAsset);
    const workLeases = readCollection(value.workLeases, readWorkLease);
    const cancellationGeneration = readNonNegativeInteger(value.cancellation.generation);
    const requestedAt = readNullableTimestamp(value.cancellation.requestedAt);
    const cancellationReason = readNullableString(value.cancellation.reason);
    const consumerAcknowledgedAt = readNullableTimestamp(value.cancellation.consumerAcknowledgedAt);
    const transportAcknowledgedAt = readNullableTimestamp(value.cancellation.transportAcknowledgedAt);
    const backendAcknowledgedAt = readNullableTimestamp(value.cancellation.backendAcknowledgedAt);
    const manualResumeReason = readNullableString(value.manualResume.reason);
    const manualResumeWorkIds = readStringArray(value.manualResume.workIds);
    const manualResumeRequiredAt = readNullableTimestamp(value.manualResume.requiredAt);
    const createGrant = value.grants.create;
    const deleteGrant = value.grants.delete;
    const routingGrant = value.grants.routing;
    const tempoGrant = value.grants.tempo;
    const masterGrant = value.grants.master;
    const fileGrant = value.grants.file;
    const audioUploadGrant = value.grants.audioUpload;
    const remoteGenerationGrant = value.grants.remoteGeneration;
    const autoCommitGrant = value.grants.autoCommit;
    if (
        createdRevision === undefined ||
        plannedRevision === undefined ||
        approvedRevision === undefined ||
        committedRevision === undefined ||
        targetIds === null ||
        targetRanges === null ||
        protectedTargetIds === null ||
        protectedRanges === null ||
        allowedOperationPrefixes === null ||
        limits === null ||
        consumed === null ||
        plan === undefined ||
        batches === null ||
        receipts === null ||
        renders === null ||
        analyses === null ||
        providerUsage === null ||
        errors === null ||
        committedWork === null ||
        retriableWork === null ||
        temporaryAssets === null ||
        workLeases === null ||
        cancellationGeneration === null ||
        requestedAt === undefined ||
        cancellationReason === undefined ||
        consumerAcknowledgedAt === undefined ||
        transportAcknowledgedAt === undefined ||
        backendAcknowledgedAt === undefined ||
        typeof value.manualResume.required !== 'boolean' ||
        manualResumeReason === undefined ||
        manualResumeWorkIds === null ||
        manualResumeRequiredAt === undefined ||
        typeof createGrant !== 'boolean' ||
        typeof deleteGrant !== 'boolean' ||
        typeof routingGrant !== 'boolean' ||
        typeof tempoGrant !== 'boolean' ||
        typeof masterGrant !== 'boolean' ||
        typeof fileGrant !== 'boolean' ||
        typeof audioUploadGrant !== 'boolean' ||
        typeof remoteGenerationGrant !== 'boolean' ||
        typeof autoCommitGrant !== 'boolean'
    ) {
        return null;
    }
    return {
        schemaVersion: AGENT_RUN_SCHEMA_VERSION,
        runId,
        request,
        mode,
        phase,
        revisions: {
            created: createdRevision,
            planned: plannedRevision,
            approved: approvedRevision,
            committed: committedRevision,
        },
        scope: { targetIds, targetRanges, protectedTargetIds, protectedRanges },
        grants: {
            allowedOperationPrefixes,
            create: createGrant,
            delete: deleteGrant,
            routing: routingGrant,
            tempo: tempoGrant,
            master: masterGrant,
            file: fileGrant,
            audioUpload: audioUploadGrant,
            remoteGeneration: remoteGenerationGrant,
            autoCommit: autoCommitGrant,
        },
        budgets: { limits, consumed },
        plan,
        batches,
        receipts,
        renders,
        analyses,
        providerUsage,
        errors,
        cancellation: {
            generation: cancellationGeneration,
            requestedAt,
            reason: cancellationReason,
            consumerAcknowledgedAt,
            transportAcknowledgedAt,
            backendAcknowledgedAt,
        },
        committedWork,
        retriableWork,
        temporaryAssets,
        manualResume: {
            required: value.manualResume.required,
            reason: manualResumeReason,
            workIds: manualResumeWorkIds,
            requiredAt: manualResumeRequiredAt,
        },
        workLeases,
        createdAt,
        updatedAt,
    };
}

export function sanitizeAgentRunState(value: unknown): AgentRunState {
    if (!isRecord(value) || value.schemaVersion !== AGENT_RUN_SCHEMA_VERSION || !Array.isArray(value.runs)) {
        return createEmptyAgentRunState();
    }
    const runs: AgentRun[] = [];
    const seenRunIds = new Set<string>();
    for (const candidate of value.runs.slice(-MAX_RUNS)) {
        const run = readAgentRun(candidate);
        if (run === null || seenRunIds.has(run.runId)) {
            continue;
        }
        seenRunIds.add(run.runId);
        runs.push(run);
    }
    return { schemaVersion: AGENT_RUN_SCHEMA_VERSION, runs };
}

export const agentRunStore = createStore<AgentRunState>({
    initialData: createEmptyAgentRunState(),
    storage: createLocalStorage<AgentRunState>('sourdaw-agent-runs', {
        preserveSanitizedSourceWhen: (value) =>
            isRecord(value) && 'schemaVersion' in value && value.schemaVersion !== AGENT_RUN_SCHEMA_VERSION,
    }),
    sanitize: sanitizeAgentRunState,
});

export function readAgentRunState(): AgentRunState {
    return structuredClone(agentRunStore.value ?? createEmptyAgentRunState());
}

export function persistAgentRunState(state: AgentRunState): void {
    const boundedState = { ...state, runs: state.runs.slice(-MAX_RUNS) };
    const sanitizedState = sanitizeAgentRunState(boundedState);
    if (sanitizedState.runs.length !== boundedState.runs.length) {
        throw new Error('Agent run state contains data outside the persistent schema bounds');
    }
    if (!agentRunStore.trySet(sanitizedState)) {
        throw new Error('Agent run state could not be persisted locally');
    }
}

export function resetAgentRunState(): void {
    persistAgentRunState(createEmptyAgentRunState());
}
