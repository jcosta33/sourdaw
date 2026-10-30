import { type CreativeRequestAuthority, type CreativeSelectionSnapshot } from './CreativeInterpretation';
import { type MeasuredPreview } from './MeasuredPreview';

/** Private persistence ceiling, independent of provider and measurement budgets. */
export const MAX_METRIC_GOAL_STATE_BYTES = 65_536;

/** Intent survives replacement of a preview. Absence never establishes a literal request. */
export type MetricGoalSource =
    | {
          readonly kind: 'recipe';
          readonly recipeId: string;
          readonly catalogVersion: number;
          readonly recipeDigest: string;
          readonly expectationIndex: number;
      }
    | { readonly kind: 'request-number'; readonly candidateId: string; readonly token: string }
    | { readonly kind: 'policy'; readonly policyId: 'integrated-loudness-match-v1' | 'spectral-centroid-comparison-v1' }
    | { readonly kind: 'unsupported' };

export type MetricGoal<MetricId extends string> = {
    readonly goalId: string;
    readonly stepId: string;
    readonly metricId: MetricId | null;
    readonly band: string | null;
    readonly targetIds: readonly string[];
    readonly referenceTargetIds: readonly string[];
    readonly range: MeasuredPreview['range'] | null;
    readonly relation:
        | 'increase'
        | 'decrease'
        | 'hold'
        | 'match-current'
        | 'greater-than-current'
        | 'less-than-current'
        | 'target'
        | 'unsupported';
    readonly targetValue: number | null;
    readonly tolerance: number;
    readonly source: MetricGoalSource;
};

export type MetricRequestAuthority<MetricId extends string> = {
    readonly schemaVersion: 1;
    readonly authorityId: string;
    readonly origin: 'complete-literal-parser' | 'configured-joint-intake' | 'admitted-workflow';
    readonly callId: string | null;
    readonly turn: number | null;
    readonly catalogId: string;
    readonly requestDigest: string;
    readonly revision: string;
    readonly projectId: string;
    readonly selection: CreativeSelectionSnapshot;
    readonly kind: 'literal' | 'non-acoustic' | 'perceptual' | 'comparative';
    readonly goals: readonly MetricGoal<MetricId>[];
    readonly creativeAuthority: CreativeRequestAuthority | null;
};

export type MetricGoalStep = {
    readonly stepId: string;
    readonly commandCount: number;
    readonly operationTypes: readonly string[];
    /** Exact cumulative commands compiled from successful authored expansions; null for an overall policy. */
    readonly recipePrefixHash: string | null;
};

export type MetricGoalProof = {
    readonly preview: MeasuredPreview;
    readonly receiptDigest: string;
};

/** A native field emitted only by the exact accepted application workflow. It grants no mutation. */
export type WorkflowNativeLiteralUse = {
    readonly workflow: 'backing-vocal-plate';
    readonly field: 'highPassHz';
    readonly actionIndex: number;
    readonly ownerActionIndex: number;
    readonly deviceActionIndex: number;
    readonly ownerId: string;
    readonly deviceId: string;
    readonly deviceType: 'builtin-filter';
    readonly paramId: 'filter-cutoff';
    readonly unit: 'Hz';
    readonly value: number;
};

/** Literal accounting beside frozen intent, never an acoustic goal or measured proof. */
export type MetricNativeLiteralUse = WorkflowNativeLiteralUse & {
    readonly authorityId: string;
    readonly requestDigest: string;
    readonly candidateId: string;
    readonly token: string;
    readonly start: number;
    readonly actionHash: string;
    readonly ownerActionHash: string;
    readonly deviceActionHash: string;
    readonly binding: {
        readonly contentHash: string;
        readonly projectId: string;
        readonly revision: string;
        readonly runId: string;
        readonly batchId: string;
        readonly commandId: string;
        readonly ownerCommandId: string;
        readonly deviceCommandId: string;
        readonly schedulePosition: number | null;
    } | null;
};

export type MetricGoalState<MetricId extends string> = {
    readonly schemaVersion: 1;
    readonly authorities: readonly MetricRequestAuthority<MetricId>[];
    readonly steps: readonly MetricGoalStep[];
    readonly proofs: readonly MetricGoalProof[];
    readonly nativeLiteralUses?: readonly MetricNativeLiteralUse[];
    readonly binding: {
        readonly contentHash: string;
        readonly revision: string;
        readonly projectId: string;
        readonly runId: string;
        readonly batchId: string;
        readonly schedulePosition: number | null;
        readonly prefixes: readonly {
            readonly stepId: string;
            readonly before: string | null;
            readonly after: string;
        }[];
    } | null;
};

export type MetricGoalEvaluation = {
    readonly status: 'not-required' | 'verified' | 'blocked';
    readonly reason: string | null;
    readonly failure: 'missing' | 'incomparable' | 'contradictory' | 'stale' | 'out-of-tolerance' | null;
    readonly criteria: readonly {
        readonly goalId: string;
        readonly stepId: string;
        readonly metricId: string | null;
        readonly band: string | null;
        readonly targetIds: readonly string[];
        readonly referenceTargetIds: readonly string[];
        readonly range: MeasuredPreview['range'] | null;
        readonly relation: MetricGoal<string>['relation'];
        readonly targetValue: number | null;
        readonly tolerance: number;
        readonly baseline: readonly number[];
        readonly observed: readonly number[];
        readonly reference: readonly number[];
        readonly unit: string | null;
        readonly source: MetricGoalSource;
        readonly status: 'verified' | 'blocked';
    }[];
};

/** Authored expectation snapshot returned by the actual expansion producer. */
export type MetricRecipeSource = {
    readonly recipeId: string;
    readonly targetId: string;
    readonly catalogVersion: number;
    readonly recipeDigest: string;
    readonly expectations: readonly {
        readonly metric: string;
        readonly band: string | null;
        readonly direction: 'increase' | 'decrease' | 'hold';
    }[];
};
