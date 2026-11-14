import { type ApplicationToolReceipt } from './ApplicationOwnedTool';
import { type MeasuredMetricEntry } from './MeasuredPreview';
import { type ProjectContextTrack } from './ProjectContext';
import { type SemanticCommandListRoleFamily } from './SemanticCommandList';

export const SCHEDULED_VIBE_RUN_PLAN_MAX_BYTES = 1024 * 1024;

export type VibeRunBeatWindow = {
    readonly startBeat: number;
    readonly endBeat: number;
};

/**
 * One `analysis.measure` result as the decomposition reads it: the beat window it rendered and each
 * rendered target's figures keyed by metric id. It is the `analysis-measurement` receipt's `range`
 * and `targets`, so a receipt's data is passed straight in.
 *
 * `range.sectionId` names a section only when the call asked for one; an explicit beat window
 * carries `null`, and so does a window that happens to match a section. It never means the whole
 * project, which `analysis.measure` has no range for, so a figure answers for a section only through
 * the window it was rendered over.
 */
export type VibeRunMeasurement = {
    readonly range: VibeRunBeatWindow & { readonly sectionId: string | null };
    readonly targets: readonly {
        readonly targetId: string;
        readonly measurements: Readonly<Partial<Record<string, MeasuredMetricEntry>>>;
    }[];
};

export type VibeRunSectionScope = {
    readonly id: string;
    readonly startBeat: number;
    readonly endBeat: number;
};

/** The metric a batch is expected to move, why, and which way. `band` is set only on a band-wise metric. */
export type VibeRunExpectedDelta = {
    readonly descriptor: string;
    readonly metric: string;
    readonly band: string | null;
    readonly direction: 'increase' | 'decrease' | 'hold';
};

/**
 * What one batch is for: the characters it pursues on one role family, over which sections.
 * `descriptors` is the union of the descriptors of every target's own recipes; which recipes apply
 * to which target is stated per target, never here.
 */
export type VibeRunBatchObjective = {
    readonly descriptors: readonly string[];
    readonly role: SemanticCommandListRoleFamily;
    /** The project's sections in timeline order; empty when the project has none and the scope is the whole project. */
    readonly sections: readonly VibeRunSectionScope[];
    readonly sectionGoals: readonly { readonly sectionId: string; readonly statement: string }[];
};

/**
 * One target of a batch with the recipes that apply to it and what those recipes promise. Targets of
 * one batch may carry different recipes: a retune recipe applies only to a track holding the device it
 * retunes. Every listed `recipeIds` entry expands on this target through `recipe.expand`, and every
 * delta in `expectedDeltas` is promised by one of those recipes and by no other.
 */
export type VibeRunBatchTarget = {
    readonly targetId: string;
    readonly recipeIds: readonly string[];
    readonly expectedDeltas: readonly VibeRunExpectedDelta[];
    /** The commands this target's recipes expand to. */
    readonly commandCount: number;
};

/**
 * One target's measured figures standing for one section, limited to the metrics that target's own
 * recipes expect to move. `window` is the beat range the figures were rendered over: the section's own, or a wider one
 * that fully contains it.
 */
export type VibeRunBaseline = {
    readonly targetId: string;
    readonly sectionId: string;
    readonly window: VibeRunBeatWindow;
    readonly measurements: Readonly<Partial<Record<string, MeasuredMetricEntry>>>;
};

export type VibeRunBatch = {
    readonly id: string;
    /** One-based position in the run: batches run, and are approved, in this order. */
    readonly ordinal: number;
    readonly objective: VibeRunBatchObjective;
    readonly targetIds: readonly string[];
    /** One entry per target, in `targetIds` order, with its own recipes and expected deltas. */
    readonly targets: readonly VibeRunBatchTarget[];
    /** The sum of each target's own `commandCount`; never above the batch cap. */
    readonly commandCount: number;
    readonly baselines: readonly VibeRunBaseline[];
    /** Targets no supplied measurement stands for in any section; their figures are read when the batch is previewed. */
    readonly unmeasuredTargetIds: readonly string[];
    /** A target and section two or more measurements answer for equally; none of their figures stands. */
    readonly baselineConflicts: readonly { readonly targetId: string; readonly sectionId: string }[];
    /** Required ranges a target carries no signal over; it has no goal there. */
    readonly silentRanges: readonly { readonly targetId: string; readonly range: VibeRunVerificationRange }[];
};

export type VibeRunExcludedTargetReason =
    'protected' | 'folder' | 'frozen' | 'unclassified-role' | 'no-applicable-recipe' | 'silent';

/** A track no batch touches, and why: the project guards it, or `recipe.expand` would refuse it. */
export type VibeRunExcludedTarget = {
    readonly targetId: string;
    readonly reason: VibeRunExcludedTargetReason;
};

export type VibeRunUnplannedRole = {
    readonly role: SemanticCommandListRoleFamily;
    readonly reason: 'no-expected-deltas' | 'target-exceeds-batch-cap';
    readonly targetIds: readonly string[];
};

export type VibeRunPlan = {
    readonly schemaVersion: 1;
    /** The revision of the production brief the plan consulted; `null` when the project holds none. */
    readonly briefRevision: number | null;
    readonly batches: readonly VibeRunBatch[];
    readonly excludedTargets: readonly VibeRunExcludedTarget[];
    /** Each target excluded as `silent`, with the metrics its recipes expect, silent over every required range. */
    readonly silentTargets: readonly { readonly targetId: string; readonly metrics: readonly string[] }[];
    readonly unplannedRoles: readonly VibeRunUnplannedRole[];
    readonly coverageRefusals: readonly {
        readonly targetId: string;
        readonly role: SemanticCommandListRoleFamily;
        readonly range: VibeRunVerificationRange;
        readonly metric: string;
        readonly band: string | null;
        readonly reason: string;
    }[];
};

/**
 * One scheduled batch keeps its frozen verification ranges and references to plan-owned initial
 * witnesses. Each approval still obtains fresh baseline and isolated preview figures at its own revision.
 * Missing range fields identify legacy unmeasured history, which cannot execute as a measured run.
 */
export type ScheduledVibeRunBatch = Pick<VibeRunBatch, 'id' | 'ordinal' | 'targetIds' | 'targets' | 'commandCount'> & {
    readonly objective: Pick<VibeRunBatchObjective, 'descriptors' | 'role'> &
        Partial<Pick<VibeRunBatchObjective, 'sections' | 'sectionGoals'>>;
    readonly verificationRanges?: readonly VibeRunVerificationRange[];
    readonly witnessIds?: readonly string[];
    /** Ranges a target is silent over, each bound to the initial receipt showing it; absent means none. */
    readonly silentRanges?: readonly VibeRunSilentRange[];
};

export type VibeRunSilentTarget = {
    readonly targetId: string;
    readonly metrics: readonly string[];
    readonly silences: readonly VibeRunSilentRange[];
};

/** A target carries no signal over one verification range, as the named initial receipt reads it. */
export type VibeRunSilentRange = {
    readonly targetId: string;
    readonly range: VibeRunVerificationRange;
    readonly receiptCallId: string;
    readonly receiptDigest: string;
};

/** The plan a `vibe-run` schedule stores, serialized, against the brief revision it was read from. */
type LegacyScheduledVibeRunPlan = {
    readonly schemaVersion: 1;
    readonly briefRevision: number;
    readonly batches: readonly ScheduledVibeRunBatch[];
};

/** Historical analysis evidence belongs to the run, never to editable Project truth. */
export type VibeRunVerificationRange = VibeRunBeatWindow & { readonly sectionId: string | null };

export type VibeRunInitialWitness = {
    readonly id: string;
    readonly receiptCallId: string;
    readonly receiptDigest: string;
    readonly targetId: string;
    readonly recipeId: string;
    readonly recipeDigest: string;
    readonly expectationIndex: number;
    readonly metric: string;
    readonly band: string | null;
    readonly range: VibeRunVerificationRange;
};

export type VibeRunInitialEvidence = {
    readonly origin: 'vibe-run-initial-baselines';
    readonly sourceRevision: string;
    readonly sourceRevisionDigest: string;
    readonly projectId: string;
    readonly runId: string;
    readonly briefId: string;
    readonly briefDigest: string;
    readonly mixIntentDigest: string;
    readonly catalogVersion: number;
    readonly roles: readonly {
        readonly targetId: string;
        readonly canonicalRole: NonNullable<ProjectContextTrack['canonicalRole']>;
    }[];
    readonly sections: readonly VibeRunSectionScope[];
    readonly arrangementRange: VibeRunVerificationRange;
    readonly receipts: readonly ApplicationToolReceipt[];
    readonly witnesses: readonly VibeRunInitialWitness[];
    /**
     * Measured targets left out of every batch because they are silent in every range, each with the
     * metrics its recipes expect and one silence per plan range bound to its receipt; absent means none.
     */
    readonly silentTargets?: readonly VibeRunSilentTarget[];
};

export type MeasuredScheduledVibeRunPlan = {
    readonly schemaVersion: 2;
    readonly briefRevision: number;
    readonly batches: readonly ScheduledVibeRunBatch[];
    readonly initial: VibeRunInitialEvidence;
    readonly initialDigest: string;
    readonly planDigest: string;
};

/** Schema 1 stays readable as an explicitly unmeasured historical plan. */
export type ScheduledVibeRunPlan = LegacyScheduledVibeRunPlan | MeasuredScheduledVibeRunPlan;

/** Optional read failures explain an unscheduled run; they never authorize an acoustic change. */
export type VibeRunInitialBaselineRefusal = {
    readonly schemaVersion: 1;
    readonly sourceRevision: string;
    readonly stage: 'preflight' | 'collection';
    readonly receiptCallIds: readonly string[];
};
