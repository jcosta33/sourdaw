import { createStore } from '#/infra/store/createStore';
import { createLocalStorage } from '#/infra/store/storage/createLocalStorage';

import { AGENT_CONTEXT_SCHEMA_VERSION, type AgentContextEvidence } from '../models/AgentContext';
import { AGENT_DATA_CATEGORIES, type AgentDataCategory } from '../models/AgentDataPolicy';
import { AGENT_EXECUTION_MODES } from '../models/AgentExecutionMode';
import {
    AGENT_RUN_PHASES,
    AGENT_RUN_SCHEMA_VERSION,
    AGENT_RUN_ERROR_CATEGORIES,
    type AgentRun,
    type AgentRunArtifact,
    type AgentRunBatch,
    type AgentRunBudgetAttempt,
    type AgentRunCommittedWork,
    type AgentRunDecision,
    type AgentRunError,
    type AgentRunPlan,
    type AgentRunPendingEffect,
    type AgentRunPendingEffectContinuation,
    type AgentRunProviderUsage,
    type AgentRunReceipt,
    type AgentRunRetriableWork,
    type AgentRunSaga,
    type AgentRunSagaStep,
    type AgentRunState,
    type AgentRunTemporaryAsset,
    type AgentRunWorkLease,
} from '../models/AgentRun';
import { type ApplicationToolReceipt } from '../models/ApplicationOwnedTool';

const MAX_RUNS = 50;
const MAX_COLLECTION_LENGTH = 256;
const MAX_TEXT_LENGTH = 128 * 1024;
const MAX_SERIALIZED_BATCH_LENGTH = 1024 * 1024;

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

function readRanges(value: unknown, allowPointRange = false): Array<{ startBeat: number; endBeat: number }> | null {
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
            candidate.startBeat < 0 ||
            (allowPointRange ? candidate.endBeat < candidate.startBeat : candidate.endBeat <= candidate.startBeat)
        ) {
            return null;
        }
        ranges.push({ startBeat: candidate.startBeat, endBeat: candidate.endBeat });
    }
    return ranges;
}

function readCommandBatchAuthority(value: unknown): AgentRunPendingEffectContinuation['authority'] | null {
    if (!isRecord(value) || !isRecord(value.scope) || !isRecord(value.grants) || !isRecord(value.budgets)) {
        return null;
    }
    const scope = value.scope;
    const grants = value.grants;
    const budgets = value.budgets;
    const projectId = readString(value.projectId);
    const baseRevision = readString(value.baseRevision);
    const targetIds = readStringArray(scope.targetIds);
    const targetRanges = readRanges(scope.targetRanges, true);
    const protectedTargetIds = readStringArray(scope.protectedTargetIds);
    const protectedRanges = readRanges(scope.protectedRanges);
    const allowedOperationPrefixes = readStringArray(grants.allowedOperationPrefixes);
    const create = typeof grants.create === 'boolean' ? grants.create : null;
    const deleteGrant = typeof grants.delete === 'boolean' ? grants.delete : null;
    const routing = typeof grants.routing === 'boolean' ? grants.routing : null;
    const tempo = typeof grants.tempo === 'boolean' ? grants.tempo : null;
    const master = typeof grants.master === 'boolean' ? grants.master : null;
    const file = typeof grants.file === 'boolean' ? grants.file : null;
    const audioUpload = typeof grants.audioUpload === 'boolean' ? grants.audioUpload : null;
    const remoteGeneration = typeof grants.remoteGeneration === 'boolean' ? grants.remoteGeneration : null;
    const autoCommit = typeof grants.autoCommit === 'boolean' ? grants.autoCommit : null;
    const maxCommands = readNonNegativeInteger(budgets.maxCommands);
    const maxCreatedTracks = readNonNegativeInteger(budgets.maxCreatedTracks);
    const maxDeletedObjects = readNonNegativeInteger(budgets.maxDeletedObjects);
    const maxAffectedTracks = readNonNegativeInteger(budgets.maxAffectedTracks);
    const maxAffectedClips = readNonNegativeInteger(budgets.maxAffectedClips);
    const maxAutomationPoints = readNonNegativeInteger(budgets.maxAutomationPoints);
    const maxImportedAssets = readNonNegativeInteger(budgets.maxImportedAssets);
    const maxRenderJobs = readNonNegativeInteger(budgets.maxRenderJobs);
    if (
        projectId === null ||
        baseRevision === null ||
        targetIds === null ||
        targetRanges === null ||
        protectedTargetIds === null ||
        protectedRanges === null ||
        allowedOperationPrefixes === null ||
        create === null ||
        deleteGrant === null ||
        routing === null ||
        tempo === null ||
        master === null ||
        file === null ||
        audioUpload === null ||
        remoteGeneration === null ||
        autoCommit === null ||
        maxCommands === null ||
        maxCreatedTracks === null ||
        maxDeletedObjects === null ||
        maxAffectedTracks === null ||
        maxAffectedClips === null ||
        maxAutomationPoints === null ||
        maxImportedAssets === null ||
        maxRenderJobs === null
    ) {
        return null;
    }
    return {
        projectId,
        baseRevision,
        scope: { targetIds, targetRanges, protectedTargetIds, protectedRanges },
        grants: {
            allowedOperationPrefixes,
            create,
            delete: deleteGrant,
            routing,
            tempo,
            master,
            file,
            audioUpload,
            remoteGeneration,
            autoCommit,
        },
        budgets: {
            maxCommands,
            maxCreatedTracks,
            maxDeletedObjects,
            maxAffectedTracks,
            maxAffectedClips,
            maxAutomationPoints,
            maxImportedAssets,
            maxRenderJobs,
        },
    };
}

function readPendingEffect(value: unknown): AgentRunPendingEffect | null {
    if (!isRecord(value)) {
        return null;
    }
    const commandId = readString(value.commandId);
    const operation = readString(value.operation);
    const reason = readString(value.reason);
    if (commandId === null || operation === null || reason === null || value.state !== 'pending') {
        return null;
    }
    if (value.kind === 'runtime-graph') {
        if (value.remediation !== 'retry' && value.remediation !== 'repair') {
            return null;
        }
        return {
            commandId,
            operation,
            reason,
            state: 'pending',
            kind: 'runtime-graph',
            remediation: value.remediation,
        };
    }
    if (value.kind === 'external-effect') {
        if (value.remediation !== 'reconcile' && value.remediation !== 'manual-repair') {
            return null;
        }
        return {
            commandId,
            operation,
            reason,
            state: 'pending',
            kind: 'external-effect',
            remediation: value.remediation,
        };
    }
    return null;
}

function readPendingEffectContinuation(value: unknown): AgentRunPendingEffectContinuation | null {
    if (!isRecord(value)) {
        return null;
    }
    const batchId = readString(value.batchId);
    const effects = readCollection(value.effects, readPendingEffect);
    const receiptIdentity = readString(value.receiptIdentity);
    const serializedBatch =
        typeof value.serializedBatch === 'string' &&
        value.serializedBatch.length > 0 &&
        value.serializedBatch.length <= MAX_SERIALIZED_BATCH_LENGTH
            ? value.serializedBatch
            : null;
    const authority = readCommandBatchAuthority(value.authority);
    const lastError = readNullableString(value.lastError);
    if (
        batchId === null ||
        effects === null ||
        effects.length === 0 ||
        new Set(effects.map(({ commandId }) => commandId)).size !== effects.length ||
        receiptIdentity === null ||
        serializedBatch === null ||
        authority === null ||
        lastError === undefined ||
        (value.recovery !== 'reconcile-batch' && value.recovery !== 'manual-repair') ||
        (value.recovery === 'manual-repair' && !effects.some(({ remediation }) => remediation === 'manual-repair')) ||
        (value.recovery === 'reconcile-batch' && effects.some(({ remediation }) => remediation === 'manual-repair'))
    ) {
        return null;
    }
    return {
        batchId,
        effects,
        receiptIdentity,
        recovery: value.recovery,
        serializedBatch,
        authority,
        lastError,
    };
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
    const attempt = value.attempt === undefined ? undefined : readNonNegativeInteger(value.attempt);
    const model = readNullableString(value.model);
    const inputTokens = value.inputTokens === null ? null : readNonNegativeInteger(value.inputTokens);
    const outputTokens = value.outputTokens === null ? null : readNonNegativeInteger(value.outputTokens);
    const cachedInputTokens =
        value.cachedInputTokens === undefined || value.cachedInputTokens === null
            ? value.cachedInputTokens
            : readNonNegativeInteger(value.cachedInputTokens);
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
    const routeId = value.routeId === undefined ? undefined : readString(value.routeId);
    const executors: NonNullable<AgentRunProviderUsage['executor']>[] = ['webllm', 'cloud', 'legacy-unknown'];
    let executor: AgentRunProviderUsage['executor'];
    if (value.executor === 'native') {
        executor = 'legacy-unknown';
    } else if (value.executor !== undefined) {
        executor = executors.find((candidate) => candidate === value.executor);
    }
    const fallbackReason = value.fallbackReason === undefined ? undefined : readNullableString(value.fallbackReason);
    const disclosure = (() => {
        if (value.disclosure === undefined) {
            return undefined;
        }
        if (!isRecord(value.disclosure)) {
            return null;
        }
        const requestId = readString(value.disclosure.requestId);
        const categories = readStringArray(value.disclosure.categories);
        const retention = value.disclosure.retention;
        if (
            requestId === null ||
            categories === null ||
            !categories.every((category) => AGENT_DATA_CATEGORIES.some((known) => known === category)) ||
            !isRecord(retention) ||
            retention.applicationState !== 'unknown' ||
            retention.abuseMonitoring !== 'unknown' ||
            retention.promptCache !== 'unknown' ||
            retention.safetyLegalException !== 'unknown' ||
            retention.unknown !== 'unknown' ||
            Object.keys(retention).length !== 5
        ) {
            return null;
        }
        return {
            requestId,
            categories: categories as AgentDataCategory[],
            retention: {
                applicationState: 'unknown' as const,
                abuseMonitoring: 'unknown' as const,
                promptCache: 'unknown' as const,
                safetyLegalException: 'unknown' as const,
                unknown: 'unknown' as const,
            },
        };
    })();
    if (
        provider === null ||
        (value.attempt !== undefined && (attempt === null || attempt === undefined || attempt < 1)) ||
        model === undefined ||
        (inputTokens === null && value.inputTokens !== null) ||
        (outputTokens === null && value.outputTokens !== null) ||
        (cachedInputTokens === null && value.cachedInputTokens !== null) ||
        !provenances.some((provenance) => provenance === value.provenance) ||
        correlationId === null ||
        (value.status !== undefined && status === undefined) ||
        !retryableIsValid ||
        (value.partialOutputDisposition !== undefined && partialOutputDisposition === undefined) ||
        routeId === null ||
        (value.executor !== undefined && executor === undefined) ||
        (value.fallbackReason !== undefined && fallbackReason === undefined) ||
        disclosure === null
    ) {
        return null;
    }
    return {
        ...(typeof attempt === 'number' ? { attempt } : {}),
        provider,
        model,
        inputTokens,
        outputTokens,
        ...(cachedInputTokens === undefined ? {} : { cachedInputTokens }),
        provenance: value.provenance as AgentRunProviderUsage['provenance'],
        ...(correlationId === undefined ? {} : { correlationId }),
        ...(status === undefined ? {} : { status }),
        ...(retryable === undefined ? {} : { retryable }),
        ...(partialOutputDisposition === undefined ? {} : { partialOutputDisposition }),
        ...(routeId === undefined ? {} : { routeId }),
        ...(executor === undefined ? {} : { executor }),
        ...(fallbackReason === undefined ? {} : { fallbackReason }),
        ...(disclosure === undefined ? {} : { disclosure }),
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
    const category = AGENT_RUN_ERROR_CATEGORIES.find((candidate) => candidate === value.category);
    const related = isRecord(value.related)
        ? {
              targetIds: readStringArray(value.related.targetIds),
              commandIds: readStringArray(value.related.commandIds),
              workIds: readStringArray(value.related.workIds),
              receiptIdentities: readStringArray(value.related.receiptIdentities),
              artifactIds: readStringArray(value.related.artifactIds),
          }
        : null;
    const remediation = isRecord(value.remediation) ? value.remediation : null;
    const cause = isRecord(value.cause) ? value.cause : null;
    const extended =
        category !== undefined &&
        related !== null &&
        related.targetIds !== null &&
        related.commandIds !== null &&
        related.workIds !== null &&
        related.receiptIdentities !== null &&
        related.artifactIds !== null &&
        remediation !== null &&
        (['never', 'read-only', 'owner-proven-idempotent'] as const).some(
            (candidate) => candidate === remediation.retry
        ) &&
        (['none', 'review-scope', 'resolve-conflict', 'retry-later', 'manual-repair', 'reconfigure'] as const).some(
            (candidate) => candidate === remediation.userAction
        ) &&
        (['not-needed', 'available', 'attempted', 'completed', 'uncompensated', 'manual-repair'] as const).some(
            (candidate) => candidate === remediation.compensation
        ) &&
        cause !== null &&
        (cause.kind === 'known-domain' || cause.kind === 'unknown-internal') &&
        readString(cause.source) !== null;
    return {
        code,
        message,
        occurredAt,
        retriable: value.retriable,
        workId,
        ...(extended
            ? {
                  category,
                  related: related as NonNullable<AgentRunError['related']>,
                  remediation: remediation as NonNullable<AgentRunError['remediation']>,
                  cause: { kind: cause.kind, source: cause.source as string } as NonNullable<AgentRunError['cause']>,
              }
            : {}),
    };
}

function readSagaStep(value: unknown): AgentRunSagaStep | null {
    if (!isRecord(value) || !isRecord(value.compensation)) {
        return null;
    }
    const stepId = readString(value.stepId);
    const workId = readString(value.workId);
    const receiptIdentity = readNullableString(value.receiptIdentity);
    const updatedAt = readTimestamp(value.updatedAt);
    const relatedArtifactIds = readStringArray(value.relatedArtifactIds);
    const order = readNonNegativeInteger(value.order);
    const owners: AgentRunSagaStep['owner'][] = [
        'provider',
        'command',
        'render',
        'analysis',
        'import',
        'external-effect',
    ];
    const states: AgentRunSagaStep['state'][] = [
        'pending',
        'external-pending',
        'committed',
        'compensated',
        'uncompensated',
        'manual-repair',
    ];
    const lastError = readNullableString(value.compensation.lastError);
    const attempts = readNonNegativeInteger(value.compensation.attempts);
    if (
        stepId === null ||
        workId === null ||
        receiptIdentity === undefined ||
        updatedAt === null ||
        relatedArtifactIds === null ||
        order === null ||
        attempts === null ||
        lastError === undefined ||
        typeof value.compensation.available !== 'boolean' ||
        !owners.some((owner) => owner === value.owner) ||
        !states.some((state) => state === value.state)
    ) {
        return null;
    }
    return {
        stepId,
        order,
        owner: value.owner as AgentRunSagaStep['owner'],
        workId,
        receiptIdentity,
        state: value.state as AgentRunSagaStep['state'],
        compensation: { available: value.compensation.available, attempts, lastError },
        relatedArtifactIds,
        updatedAt,
    };
}

function readSaga(value: unknown): AgentRunSaga | null {
    if (value === undefined) {
        return { schemaVersion: 1, steps: [] };
    }
    if (!isRecord(value) || value.schemaVersion !== 1) {
        return null;
    }
    const steps = readCollection(value.steps, readSagaStep);
    return steps === null ? null : { schemaVersion: 1, steps };
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

function readApplicationToolReceipt(value: unknown): ApplicationToolReceipt | null {
    if (
        !isRecord(value) ||
        value.schema !== 'sourdaw.application-tool-receipt' ||
        value.schemaVersion !== 1 ||
        (value.status !== 'success' && value.status !== 'failure')
    ) {
        return null;
    }
    const callId = readString(value.callId);
    const toolName = readString(value.toolName);
    const turn = readNonNegativeInteger(value.turn);
    const revision = readNullableString(value.revision);
    const summary = readString(value.summary);
    const warnings = readStringArray(value.warnings);
    if (
        callId === null ||
        toolName === null ||
        turn === null ||
        turn < 1 ||
        revision === undefined ||
        summary === null ||
        warnings === null
    ) {
        return null;
    }
    let error: ApplicationToolReceipt['error'] = null;
    if (value.error !== null) {
        if (!isRecord(value.error)) {
            return null;
        }
        const code = readString(value.error.code);
        const safeMessage = readString(value.error.safeMessage);
        if (code === null || safeMessage === null || typeof value.error.retryable !== 'boolean') {
            return null;
        }
        error = { code, safeMessage, retryable: value.error.retryable };
    }
    if ((value.status === 'success' && error !== null) || (value.status === 'failure' && error === null)) {
        return null;
    }
    return {
        schema: 'sourdaw.application-tool-receipt',
        schemaVersion: 1,
        callId,
        toolName,
        turn,
        status: value.status,
        revision,
        data: structuredClone(value.data),
        summary,
        warnings,
        error,
    };
}

function readAgentContextEvidence(value: unknown): AgentContextEvidence | null {
    if (value === null) {
        return null;
    }
    if (
        !isRecord(value) ||
        value.schemaVersion !== AGENT_CONTEXT_SCHEMA_VERSION ||
        !isRecord(value.selection) ||
        !isRecord(value.included) ||
        !isRecord(value.delta) ||
        !isRecord(value.snapshot)
    ) {
        return null;
    }
    const included = value.included;
    const revision = readNullableString(value.revision);
    const trackId = readNullableString(value.selection.trackId);
    const clipId = readNullableString(value.selection.clipId);
    const clipIds = readStringArray(value.selection.clipIds);
    const deltaBaseRevision = readNullableString(value.delta.baseRevision);
    const deltaCurrentRevision = readNullableString(value.delta.currentRevision);
    const snapshot = (() => {
        const rawSnapshot = value.snapshot;
        const identity = readString(rawSnapshot.identity);
        const selectedTrack = (() => {
            if (rawSnapshot.selectedTrack === null) {
                return null;
            }
            if (!isRecord(rawSnapshot.selectedTrack)) {
                return undefined;
            }
            const id = readString(rawSnapshot.selectedTrack.id);
            const digest = readString(rawSnapshot.selectedTrack.digest);
            return id === null || digest === null ? undefined : { id, digest };
        })();
        const selectableTargets = readCollection(rawSnapshot.selectableTargets, (candidate) => {
            if (!isRecord(candidate)) {
                return null;
            }
            const id = readString(candidate.id);
            const digest = readString(candidate.digest);
            return id === null || digest === null ? null : { id, digest };
        });
        if (
            identity === null ||
            typeof rawSnapshot.tempo !== 'number' ||
            !Number.isFinite(rawSnapshot.tempo) ||
            !Array.isArray(rawSnapshot.timeSignature) ||
            rawSnapshot.timeSignature.length !== 2 ||
            !rawSnapshot.timeSignature.every((value) => typeof value === 'number' && Number.isFinite(value)) ||
            selectedTrack === undefined ||
            selectableTargets === null ||
            readNonNegativeInteger(rawSnapshot.targetCount) === null ||
            typeof rawSnapshot.truncated !== 'boolean'
        ) {
            return undefined;
        }
        return {
            identity,
            tempo: rawSnapshot.tempo,
            timeSignature: [rawSnapshot.timeSignature[0], rawSnapshot.timeSignature[1]] as [number, number],
            selectedTrack,
            selectableTargets,
            targetCount: readNonNegativeInteger(rawSnapshot.targetCount)!,
            truncated: rawSnapshot.truncated,
        };
    })();
    const validationFailures = (() => {
        if (!isRecord(included.validationFailures)) {
            return undefined;
        }
        const total = readNonNegativeInteger(included.validationFailures.total);
        const retained = readNonNegativeInteger(included.validationFailures.retained);
        const omitted = readNonNegativeInteger(included.validationFailures.omitted);
        return total === null || retained === null || omitted === null || total !== retained + omitted
            ? undefined
            : { total, retained, omitted };
    })();
    const grants = (() => {
        const rawGrants = value.grants;
        if (rawGrants === null) {
            return null;
        }
        if (!isRecord(rawGrants)) {
            return undefined;
        }
        const allowedOperationPrefixes = readStringArray(rawGrants.allowedOperationPrefixes);
        const flags = [
            'create',
            'delete',
            'routing',
            'tempo',
            'master',
            'file',
            'audioUpload',
            'remoteGeneration',
            'autoCommit',
        ] as const;
        if (allowedOperationPrefixes === null || !flags.every((flag) => typeof rawGrants[flag] === 'boolean')) {
            return undefined;
        }
        return {
            allowedOperationPrefixes,
            ...Object.fromEntries(flags.map((flag) => [flag, rawGrants[flag]])),
        } as AgentContextEvidence['grants'];
    })();
    const budgets = (() => {
        if (value.budgets === null) {
            return null;
        }
        if (!isRecord(value.budgets)) {
            return undefined;
        }
        const limits = readNumberRecord(value.budgets.limits);
        const consumed = readNumberRecord(value.budgets.consumed);
        return limits === null || consumed === null ? undefined : { limits, consumed };
    })();
    if (
        revision === undefined ||
        trackId === undefined ||
        clipId === undefined ||
        clipIds === null ||
        deltaBaseRevision === undefined ||
        deltaCurrentRevision === undefined ||
        (value.delta.mode !== 'full' && value.delta.mode !== 'delta') ||
        readNonNegativeInteger(included.receiptCount) === null ||
        readNonNegativeInteger(included.capabilitySchemaCount) === null ||
        readNonNegativeInteger(included.measurementCount) === null ||
        readNonNegativeInteger(included.trackCount) === null ||
        validationFailures === undefined ||
        snapshot === undefined ||
        grants === undefined ||
        budgets === undefined
    ) {
        return null;
    }
    return {
        schemaVersion: AGENT_CONTEXT_SCHEMA_VERSION,
        revision,
        selection: { trackId, clipId, clipIds },
        grants,
        budgets,
        included: {
            receiptCount: readNonNegativeInteger(included.receiptCount)!,
            capabilitySchemaCount: readNonNegativeInteger(included.capabilitySchemaCount)!,
            validationFailures,
            measurementCount: readNonNegativeInteger(included.measurementCount)!,
            trackCount: readNonNegativeInteger(included.trackCount)!,
        },
        snapshot,
        delta: { mode: value.delta.mode, baseRevision: deltaBaseRevision, currentRevision: deltaCurrentRevision },
    };
}

function readAgentRunPlan(value: unknown, fallbackScope: AgentRun['scope']): AgentRunPlan | null | undefined {
    if (value === null) {
        return null;
    }
    if (!isRecord(value)) {
        return undefined;
    }
    const summary = readString(value.summary);
    const commandIds = readStringArray(value.commandIds);
    const serializedBatchIdentity = readNullableString(value.serializedBatchIdentity);
    const applicationToolReceipts =
        value.applicationToolReceipts === undefined
            ? []
            : readCollection(value.applicationToolReceipts, readApplicationToolReceipt);
    if (
        summary === null ||
        commandIds === null ||
        serializedBatchIdentity === undefined ||
        applicationToolReceipts === null
    ) {
        return undefined;
    }
    if (value.revision === undefined) {
        return {
            summary,
            commandIds,
            serializedBatchIdentity,
            applicationToolReceipts,
            revision: null,
            classification: 'simple',
            showPlanPanel: false,
            objective: summary,
            interpretedConstraints: [],
            scope: structuredClone(fallbackScope),
            steps: [],
            expectedImpact: {
                project: [],
                audible: { status: 'not-claimed', reason: 'No audible result is claimed by a legacy plan.' },
            },
            capabilities: [],
            risks: [],
            approvalPoints: [],
            validationStrategy: [],
            stoppingConditions: [],
            alternatives: [],
            needsUserDecision: false,
        };
    }
    const revision = readNullableString(value.revision);
    const classification =
        value.classification === 'simple' || value.classification === 'complex' ? value.classification : null;
    const showPlanPanel = value.showPlanPanel;
    const objective = readString(value.objective);
    const interpretedConstraints = readStringArray(value.interpretedConstraints);
    const planScope = isRecord(value.scope)
        ? {
              targetIds: readStringArray(value.scope.targetIds),
              targetRanges: readRanges(value.scope.targetRanges, true),
              protectedTargetIds: readStringArray(value.scope.protectedTargetIds),
              protectedRanges: readRanges(value.scope.protectedRanges, false),
          }
        : null;
    const steps = readCollection(value.steps, (candidate) => {
        if (!isRecord(candidate)) {
            return null;
        }
        const order = readNonNegativeInteger(candidate.order);
        const actionType = readString(candidate.actionType);
        const description = readString(candidate.description);
        return order === null || order === 0 || actionType === null || description === null
            ? null
            : { order, actionType, description };
    });
    const expectedImpact =
        isRecord(value.expectedImpact) && isRecord(value.expectedImpact.audible)
            ? {
                  project: readStringArray(value.expectedImpact.project),
                  audible:
                      value.expectedImpact.audible.status === 'not-claimed'
                          ? { status: 'not-claimed' as const, reason: readString(value.expectedImpact.audible.reason) }
                          : null,
              }
            : null;
    const capabilities = readCollection(value.capabilities, (candidate) => {
        if (!isRecord(candidate)) {
            return null;
        }
        const id = readString(candidate.id);
        const prerequisite = readString(candidate.prerequisite);
        const source = ['action-catalog', 'application-tool-catalog', 'budget', 'asset', 'data-policy'].find(
            (entry) => entry === candidate.source
        );
        const status = ['available', 'required', 'unavailable'].find((entry) => entry === candidate.status);
        return id === null || prerequisite === null || source === undefined || status === undefined
            ? null
            : { id, prerequisite, source, status };
    });
    const risks = readStringArray(value.risks);
    const approvalPoints = readCollection(value.approvalPoints, (candidate) => {
        if (!isRecord(candidate)) {
            return null;
        }
        const reason = readString(candidate.reason);
        const kind = ['command-confirmation', 'user-decision'].find((entry) => entry === candidate.kind);
        return reason === null || kind === undefined ? null : { kind, reason };
    });
    const validationStrategy = readStringArray(value.validationStrategy);
    const stoppingConditions = readStringArray(value.stoppingConditions);
    const alternatives = readCollection(value.alternatives, (candidate) => {
        if (!isRecord(candidate)) {
            return null;
        }
        const id = readString(candidate.id);
        const label = readString(candidate.label);
        return id === null || label === null || typeof candidate.changesAuthority !== 'boolean'
            ? null
            : { id, label, changesAuthority: candidate.changesAuthority };
    });
    return revision === undefined ||
        classification === null ||
        typeof showPlanPanel !== 'boolean' ||
        objective === null ||
        interpretedConstraints === null ||
        planScope === null ||
        planScope.targetIds === null ||
        planScope.targetRanges === null ||
        planScope.protectedTargetIds === null ||
        planScope.protectedRanges === null ||
        steps === null ||
        expectedImpact === null ||
        expectedImpact.project === null ||
        expectedImpact.audible === null ||
        expectedImpact.audible.reason === null ||
        capabilities === null ||
        risks === null ||
        approvalPoints === null ||
        validationStrategy === null ||
        stoppingConditions === null ||
        alternatives === null ||
        typeof value.needsUserDecision !== 'boolean'
        ? undefined
        : {
              summary,
              commandIds,
              serializedBatchIdentity,
              applicationToolReceipts,
              revision,
              classification,
              showPlanPanel,
              objective,
              interpretedConstraints,
              scope: planScope as AgentRun['scope'],
              steps,
              expectedImpact: {
                  project: expectedImpact.project,
                  audible: { status: 'not-claimed', reason: expectedImpact.audible.reason },
              },
              capabilities: capabilities as AgentRunPlan['capabilities'],
              risks,
              approvalPoints: approvalPoints as AgentRunPlan['approvalPoints'],
              validationStrategy,
              stoppingConditions,
              alternatives,
              needsUserDecision: value.needsUserDecision,
          };
}

function readAgentRunDecision(value: unknown): AgentRunDecision | null | undefined {
    if (value === null || value === undefined) {
        return null;
    }
    if (!isRecord(value) || !isRecord(value.scope) || !isRecord(value.grants)) {
        return undefined;
    }
    const grants = value.grants;
    const decisionId = readString(value.decisionId);
    const capabilitySchemaIdentity = readString(value.capabilitySchemaIdentity);
    const proposalIdentity = readString(value.proposalIdentity);
    const revision = readString(value.revision);
    const budgets = isRecord(value.budgets)
        ? { limits: readNumberRecord(value.budgets.limits), consumed: readNumberRecord(value.budgets.consumed) }
        : null;
    const reason = readString(value.reason);
    const selectedAlternativeId = readNullableString(value.selectedAlternativeId);
    // A persisted decision from before resumptions were leased was not claimed.
    const resumeAttemptId = value.resumeAttemptId === undefined ? null : readNullableString(value.resumeAttemptId);
    const targetIds = readStringArray(value.scope.targetIds);
    const targetRanges = readRanges(value.scope.targetRanges, true);
    const protectedTargetIds = readStringArray(value.scope.protectedTargetIds);
    const protectedRanges = readRanges(value.scope.protectedRanges, false);
    const allowedOperationPrefixes = readStringArray(value.grants.allowedOperationPrefixes);
    const alternatives = readCollection(value.alternatives, (candidate) => {
        if (!isRecord(candidate)) {
            return null;
        }
        const id = readString(candidate.id);
        const label = readString(candidate.label);
        return id === null || label === null || typeof candidate.changesAuthority !== 'boolean'
            ? null
            : { id, label, changesAuthority: candidate.changesAuthority };
    });
    const grantNames = [
        'create',
        'delete',
        'routing',
        'tempo',
        'master',
        'file',
        'audioUpload',
        'remoteGeneration',
        'autoCommit',
    ] as const;
    if (
        decisionId === null ||
        capabilitySchemaIdentity === null ||
        proposalIdentity === null ||
        budgets === null ||
        budgets.limits === null ||
        budgets.consumed === null
    ) {
        // Older or malformed decision evidence cannot be resumed, but must not erase the enclosing run.
        return null;
    }
    if (
        revision === null ||
        reason === null ||
        selectedAlternativeId === undefined ||
        resumeAttemptId === undefined ||
        targetIds === null ||
        targetRanges === null ||
        protectedTargetIds === null ||
        protectedRanges === null ||
        allowedOperationPrefixes === null ||
        alternatives === null ||
        grantNames.some((name) => typeof grants[name] !== 'boolean')
    ) {
        return undefined;
    }
    return {
        decisionId,
        capabilitySchemaIdentity,
        proposalIdentity,
        budgets: { limits: budgets.limits, consumed: budgets.consumed },
        revision,
        scope: { targetIds, targetRanges, protectedTargetIds, protectedRanges },
        grants: {
            allowedOperationPrefixes,
            create: grants.create as boolean,
            delete: grants.delete as boolean,
            routing: grants.routing as boolean,
            tempo: grants.tempo as boolean,
            master: grants.master as boolean,
            file: grants.file as boolean,
            audioUpload: grants.audioUpload as boolean,
            remoteGeneration: grants.remoteGeneration as boolean,
            autoCommit: grants.autoCommit as boolean,
        },
        alternatives,
        reason,
        selectedAlternativeId,
        resumeAttemptId,
    };
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
    const targetRanges = readRanges(value.scope.targetRanges, true);
    const protectedTargetIds = readStringArray(value.scope.protectedTargetIds);
    const protectedRanges = readRanges(value.scope.protectedRanges, false);
    const allowedOperationPrefixes = readStringArray(value.grants.allowedOperationPrefixes);
    const limits = readNumberRecord(value.budgets.limits);
    const consumed = readNumberRecord(value.budgets.consumed);
    const budgetAttempts = (() => {
        if (value.budgetAttempts === undefined) {
            return [];
        }
        return readCollection(value.budgetAttempts, (candidate) => {
            if (!isRecord(candidate)) {
                return null;
            }
            const attemptId = readString(candidate.attemptId);
            const category = readString(candidate.category);
            const reserved =
                typeof candidate.reserved === 'number' && Number.isFinite(candidate.reserved)
                    ? candidate.reserved
                    : null;
            const actual =
                typeof candidate.actual === 'number' && Number.isFinite(candidate.actual) ? candidate.actual : null;
            const provenance = (['provider-reported', 'versioned-estimate', 'unavailable'] as const).find(
                (value) => value === candidate.provenance
            );
            let estimateMethod: AgentRunBudgetAttempt['estimateMethod'] | null = undefined;
            if (candidate.estimateMethod !== undefined) {
                estimateMethod =
                    candidate.estimateMethod === 'compiled-provider-request-utf8-byte-token-ceiling-v1'
                        ? 'compiled-provider-request-utf8-byte-token-ceiling-v1'
                        : null;
            }
            return attemptId === null ||
                category === null ||
                reserved === null ||
                actual === null ||
                provenance === undefined ||
                estimateMethod === null ||
                typeof candidate.final !== 'boolean'
                ? null
                : {
                      attemptId,
                      category,
                      reserved,
                      actual,
                      provenance,
                      ...(estimateMethod === undefined ? {} : { estimateMethod }),
                      final: candidate.final,
                  };
        });
    })();
    const plan = readAgentRunPlan(value.plan, {
        targetIds: targetIds ?? [],
        targetRanges: targetRanges ?? [],
        protectedTargetIds: protectedTargetIds ?? [],
        protectedRanges: protectedRanges ?? [],
    });
    const decision = readAgentRunDecision(value.decision);
    const resume =
        value.resume === undefined || value.resume === null
            ? null
            : (() => {
                  if (!isRecord(value.resume)) {
                      return null;
                  }
                  const sourceRunId = readString(value.resume.sourceRunId);
                  const decisionId = readString(value.resume.decisionId);
                  const selectedAlternativeId = readString(value.resume.selectedAlternativeId);
                  const proposalIdentity = readString(value.resume.proposalIdentity);
                  const capabilitySchemaIdentity = readString(value.resume.capabilitySchemaIdentity);
                  const revision = readString(value.resume.revision);
                  const selectedAlternative = value.resume.selectedAlternative;
                  const scope = value.resume.scope;
                  const grants = value.resume.grants;
                  const budgets = value.resume.budgets;
                  if (
                      sourceRunId === null ||
                      decisionId === null ||
                      selectedAlternativeId === null ||
                      proposalIdentity === null ||
                      capabilitySchemaIdentity === null ||
                      revision === null ||
                      !isRecord(selectedAlternative) ||
                      !isRecord(scope) ||
                      !isRecord(grants) ||
                      !isRecord(budgets)
                  ) {
                      return null;
                  }
                  const parsedDecision = readAgentRunDecision({
                      decisionId,
                      capabilitySchemaIdentity,
                      proposalIdentity,
                      budgets,
                      revision,
                      scope,
                      grants,
                      alternatives: [selectedAlternative],
                      reason: 'resume',
                      selectedAlternativeId,
                      resumeAttemptId: null,
                  });
                  const alternative = parsedDecision?.alternatives[0];
                  return parsedDecision === null ||
                      parsedDecision === undefined ||
                      alternative === undefined ||
                      alternative.id !== selectedAlternativeId
                      ? null
                      : {
                            sourceRunId,
                            decisionId,
                            selectedAlternativeId,
                            selectedAlternative: alternative,
                            proposalIdentity,
                            capabilitySchemaIdentity,
                            revision,
                            scope: parsedDecision.scope,
                            grants: parsedDecision.grants,
                            budgets: parsedDecision.budgets,
                        };
              })();
    const batches = readCollection(value.batches, readBatch);
    const receipts = readCollection(value.receipts, readReceipt);
    const renders = readCollection(value.renders, readArtifact);
    const analyses = readCollection(value.analyses, readArtifact);
    const providerUsage = readCollection(value.providerUsage, readProviderUsage);
    const modelRoute = (() => {
        const rawModelRoute = value.modelRoute;
        if (rawModelRoute === undefined) {
            return { requestedRoute: 'legacy-unknown' as const, selectedRouteId: null };
        }
        if (!isRecord(rawModelRoute)) {
            return null;
        }
        const requestedRoutes = ['auto', 'webllm', 'cloud', 'legacy-unknown'] as const;
        const requestedRoute =
            rawModelRoute.requestedRoute === 'native'
                ? 'legacy-unknown'
                : requestedRoutes.find((candidate) => candidate === rawModelRoute.requestedRoute);
        const selectedRouteId = readNullableString(rawModelRoute.selectedRouteId);
        return requestedRoute === undefined || selectedRouteId === undefined
            ? null
            : { requestedRoute, selectedRouteId };
    })();
    const errors = readCollection(value.errors, readError);
    const saga = readSaga(value.saga);
    const committedWork = readCollection(value.committedWork, readCommittedWork);
    const retriableWork = readCollection(value.retriableWork, readRetriableWork);
    const temporaryAssets = readCollection(value.temporaryAssets, readTemporaryAsset);
    const pendingEffectContinuations =
        value.pendingEffectContinuations === undefined
            ? []
            : readCollection(value.pendingEffectContinuations, readPendingEffectContinuation);
    const workLeases = readCollection(value.workLeases, readWorkLease);
    const contextEvidence =
        value.contextEvidence === undefined ? null : readAgentContextEvidence(value.contextEvidence);
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
        budgetAttempts === null ||
        plan === undefined ||
        decision === undefined ||
        batches === null ||
        receipts === null ||
        renders === null ||
        analyses === null ||
        modelRoute === null ||
        providerUsage === null ||
        errors === null ||
        saga === null ||
        committedWork === null ||
        retriableWork === null ||
        temporaryAssets === null ||
        pendingEffectContinuations === null ||
        workLeases === null ||
        (contextEvidence === null && value.contextEvidence !== undefined && value.contextEvidence !== null) ||
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
        budgetAttempts,
        plan,
        decision,
        resume,
        batches,
        receipts,
        renders,
        analyses,
        modelRoute,
        providerUsage,
        errors,
        saga,
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
        pendingEffectContinuations,
        manualResume: {
            required: value.manualResume.required,
            reason: manualResumeReason,
            workIds: manualResumeWorkIds,
            requiredAt: manualResumeRequiredAt,
        },
        workLeases,
        contextEvidence,
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
