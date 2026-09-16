import { type AgentRun, type AgentRunGrants, type AgentRunModelRoute, type AgentRunPhase } from './AgentRun';

export const AGENT_RUN_TELEMETRY_SCHEMA_VERSION = 1 as const;

/**
 * Provider request and correlation identifiers the run recorded, deduplicated
 * with their first-seen order preserved so a support thread can follow the
 * attempts in the order the run made them.
 */
export type AgentRunTelemetryCorrelation = {
    readonly requestIds: readonly string[];
    readonly correlationIds: readonly string[];
};

export type AgentRunTelemetryProviderAttempt = {
    readonly attempt: number | null;
    readonly provider: string;
    readonly model: string | null;
    readonly routeId: string | null;
    readonly executor: string | null;
    readonly status: string | null;
    readonly fallbackReason: string | null;
    readonly provenance: string;
};

export type AgentRunTelemetryScope = {
    readonly targetIdCount: number;
    readonly protectedTargetIdCount: number;
    readonly targetRangeCount: number;
    readonly protectedRangeCount: number;
};

export type AgentRunTelemetryPlan = {
    readonly stepCount: number;
    readonly actionTypes: readonly string[];
    readonly approvalPointKinds: readonly string[];
};

export type AgentRunTelemetryCommands = {
    readonly batchCount: number;
    readonly batchStatuses: readonly string[];
    readonly commandCount: number;
};

export type AgentRunTelemetryArtifactCounts = {
    readonly pending: number;
    readonly completed: number;
    readonly failed: number;
};

export type AgentRunTelemetryCosts = {
    readonly inputTokens: number | null;
    readonly outputTokens: number | null;
    readonly cachedInputTokens: number | null;
    readonly budgetLimits: Record<string, number>;
    readonly budgetConsumed: Record<string, number>;
};

export type AgentRunTelemetryError = {
    readonly code: string;
    readonly category: string | null;
    readonly retriable: boolean;
    readonly occurredAt: number;
};

/**
 * Bounded operational evidence about one agent run.
 *
 * Every string leaf is an identifier, an enum literal, or a revision the run
 * already owns. The run's free text — its request, plan step descriptions,
 * decision reason, error messages, cancellation reason and artifact summaries —
 * has no field here, so no project content and no provider output reaches a
 * telemetry sink through this record.
 */
export type AgentRunTelemetryRecord = {
    readonly schemaVersion: typeof AGENT_RUN_TELEMETRY_SCHEMA_VERSION;
    readonly tier: 'telemetry';
    readonly runId: string;
    readonly correlation: AgentRunTelemetryCorrelation;
    readonly revisions: AgentRun['revisions'];
    readonly mode: AgentRun['mode'];
    readonly finalStatus: AgentRunPhase;
    readonly provider: readonly AgentRunTelemetryProviderAttempt[];
    readonly modelRoute: AgentRunModelRoute;
    readonly scope: AgentRunTelemetryScope;
    readonly grants: AgentRunGrants;
    readonly plan: AgentRunTelemetryPlan | null;
    readonly commands: AgentRunTelemetryCommands;
    readonly receipts: { readonly count: number };
    readonly artifacts: {
        readonly renders: AgentRunTelemetryArtifactCounts;
        readonly analyses: AgentRunTelemetryArtifactCounts;
    };
    readonly costs: AgentRunTelemetryCosts;
    readonly latency: { readonly runElapsedMs: number };
    readonly errors: readonly AgentRunTelemetryError[];
    readonly cancellation: { readonly requested: boolean; readonly reason: null };
};

/**
 * One free-text field of a run, carried as its length alone or as text whose
 * credential shapes have already been replaced. There is no third form: a
 * diagnostics record never carries an unredacted string.
 */
export type RedactedText =
    | { readonly kind: 'withheld'; readonly length: number }
    | { readonly kind: 'text'; readonly text: string; readonly secretsRedacted: number };

export type AgentRunDiagnosticsDetail = {
    readonly request: RedactedText;
    readonly planDescriptions: readonly RedactedText[];
    readonly decisionReason: RedactedText | null;
    readonly errorMessages: readonly RedactedText[];
    readonly cancellationReason: RedactedText | null;
    readonly providerFallbackReasons: readonly RedactedText[];
};

/**
 * The telemetry record plus redacted free text, for a developer reading one
 * run. `tier` is replaced rather than intersected: intersecting two string
 * literals yields `never`, which no record could satisfy.
 */
export type AgentRunDiagnosticsRecord = Omit<AgentRunTelemetryRecord, 'tier'> & {
    readonly tier: 'diagnostics';
    readonly detail: AgentRunDiagnosticsDetail;
};

/** Project content is withheld unless the caller asks for it. */
export type AgentRunDiagnosticsOptions = {
    readonly includeProjectContent?: boolean;
};
