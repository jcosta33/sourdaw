import { type AgentRun, type AgentRunArtifact, type AgentRunProviderUsage } from '../models/AgentRun';
import {
    AGENT_RUN_TELEMETRY_SCHEMA_VERSION,
    type AgentRunTelemetryArtifactCounts,
    type AgentRunTelemetryPlan,
    type AgentRunTelemetryProviderAttempt,
    type AgentRunTelemetryRecord,
} from '../models/AgentRunTelemetry';

function deduplicate(values: readonly string[]): string[] {
    return [...new Set(values)];
}

function readProviderAttempt(usage: AgentRunProviderUsage): AgentRunTelemetryProviderAttempt {
    return {
        attempt: usage.attempt ?? null,
        provider: usage.provider,
        model: usage.model,
        routeId: usage.routeId ?? null,
        executor: usage.executor ?? null,
        status: usage.status ?? null,
        fallbackReason: usage.fallbackReason ?? null,
        provenance: usage.provenance,
    };
}

/** Total one token field over the usage entries, or null when no entry reported it. */
function sumReportedTokens(
    providerUsage: readonly AgentRunProviderUsage[],
    readTokens: (usage: AgentRunProviderUsage) => number | null | undefined
): number | null {
    const reported = providerUsage.flatMap((usage) => {
        const tokens = readTokens(usage);
        return typeof tokens === 'number' ? [tokens] : [];
    });
    if (reported.length === 0) {
        return null;
    }
    return reported.reduce((total, tokens) => total + tokens, 0);
}

function countArtifacts(artifacts: readonly AgentRunArtifact[]): AgentRunTelemetryArtifactCounts {
    return {
        pending: artifacts.filter((artifact) => artifact.status === 'pending').length,
        completed: artifacts.filter((artifact) => artifact.status === 'completed').length,
        failed: artifacts.filter((artifact) => artifact.status === 'failed').length,
    };
}

function projectPlan(plan: AgentRun['plan']): AgentRunTelemetryPlan | null {
    if (plan === null) {
        return null;
    }
    return {
        stepCount: plan.steps.length,
        actionTypes: plan.steps.map((step) => step.actionType),
        approvalPointKinds: plan.approvalPoints.map((approvalPoint) => approvalPoint.kind),
    };
}

/**
 * Project the bounded operational evidence of one run.
 *
 * The record is built field by field rather than spread from the run, because
 * every free-text field of a run is excluded by construction here: a field
 * added to `AgentRun` reaches telemetry only when someone adds it below.
 */
export function projectAgentRunTelemetry(run: AgentRun): AgentRunTelemetryRecord {
    return {
        schemaVersion: AGENT_RUN_TELEMETRY_SCHEMA_VERSION,
        tier: 'telemetry',
        runId: run.runId,
        correlation: {
            requestIds: deduplicate(
                run.providerUsage.flatMap((usage) => (usage.disclosure ? [usage.disclosure.requestId] : []))
            ),
            correlationIds: deduplicate(
                run.providerUsage.flatMap((usage) => (usage.correlationId === undefined ? [] : [usage.correlationId]))
            ),
        },
        revisions: structuredClone(run.revisions),
        mode: run.mode,
        finalStatus: run.phase,
        provider: run.providerUsage.map(readProviderAttempt),
        modelRoute: structuredClone(run.modelRoute),
        scope: {
            targetIdCount: run.scope.targetIds.length,
            protectedTargetIdCount: run.scope.protectedTargetIds.length,
            targetRangeCount: run.scope.targetRanges.length,
            protectedRangeCount: run.scope.protectedRanges.length,
        },
        grants: structuredClone(run.grants),
        plan: projectPlan(run.plan),
        commands: {
            batchCount: run.batches.length,
            batchStatuses: run.batches.map((batch) => batch.status),
            commandCount: run.batches.reduce((total, batch) => total + batch.commandIds.length, 0),
        },
        receipts: { count: run.receipts.length },
        artifacts: { renders: countArtifacts(run.renders), analyses: countArtifacts(run.analyses) },
        costs: {
            inputTokens: sumReportedTokens(run.providerUsage, (usage) => usage.inputTokens),
            outputTokens: sumReportedTokens(run.providerUsage, (usage) => usage.outputTokens),
            cachedInputTokens: sumReportedTokens(run.providerUsage, (usage) => usage.cachedInputTokens),
            budgetLimits: structuredClone(run.budgets.limits),
            budgetConsumed: structuredClone(run.budgets.consumed),
        },
        latency: { runElapsedMs: Math.max(0, run.updatedAt - run.createdAt) },
        errors: run.errors.map((error) => ({
            code: error.code,
            category: error.category ?? null,
            retriable: error.retriable,
            occurredAt: error.occurredAt,
        })),
        cancellation: { requested: run.cancellation.requestedAt !== null, reason: null },
    };
}
